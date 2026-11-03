import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
COOKIE_NAME = "ooh_session"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_MIN_LENGTH = 12
MAX_REQUEST_BYTES = 4096
LOGIN_LIMIT = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_ATTEMPTS = {}


def default_data_dir():
    base = os.environ.get("LOCALAPPDATA")
    return Path(base) / "OutdoorMediaManagementSystem" if base else Path.home() / ".outdoor-media-management-system"


def database_path(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "auth.sqlite3"


def connect_database(data_dir):
    connection = sqlite3.connect(database_path(data_dir), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(data_dir):
    with connect_database(data_dir) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                display_id TEXT NOT NULL,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash BLOB PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            """
        )


def hash_password(password, salt):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)


def token_digest(token):
    return hashlib.sha256(token.encode("ascii")).digest()


def create_session(connection, user_id):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    connection.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token_digest(token), user_id, now + SESSION_SECONDS, now),
    )
    return token


def user_summary(row):
    return {"userId": row["display_id"]}


class ApplicationHandler(SimpleHTTPRequestHandler):
    server_version = "OutdoorMediaLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    @property
    def data_dir(self):
        return self.server.data_dir

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def do_GET(self):
        if urlsplit(self.path).path == "/api/auth/status":
            try:
                self.handle_auth_status()
            except sqlite3.Error:
                self.log_error("Authentication database operation failed.")
                self.send_json(500, {"error": "Authentication storage is unavailable. Restart the local server and try again."})
            return
        super().do_GET()

    def do_POST(self):
        route = urlsplit(self.path).path
        if route not in {"/api/auth/setup", "/api/auth/login", "/api/auth/logout"}:
            self.send_json(404, {"error": "Not found."})
            return
        if not self.is_local_request():
            self.send_json(403, {"error": "Requests must come from this local application."})
            return
        try:
            payload = self.read_json_body()
            if route == "/api/auth/setup":
                self.handle_setup(payload)
            elif route == "/api/auth/login":
                self.handle_login(payload)
            else:
                self.handle_logout()
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error:
            self.log_error("Authentication database operation failed.")
            self.send_json(500, {"error": "Authentication storage is unavailable. Restart the local server and try again."})

    def is_local_request(self):
        allowed_hosts = {"127.0.0.1", "localhost"}
        request_host = self.headers.get("Host", "").split(":", 1)[0].lower()
        if request_host not in allowed_hosts:
            return False
        origin = self.headers.get("Origin")
        if origin:
            return origin.lower() == f"http://{self.headers.get('Host', '').lower()}"
        return True

    def read_json_body(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Expected a JSON request.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body is missing or too large.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Invalid JSON request.") from error
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object.")
        return payload

    def send_json(self, status, payload, cookie=None, clear_cookie=False):
        response = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(response)))
        if cookie:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE_NAME}={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_SECONDS}",
            )
        elif clear_cookie:
            self.send_header(
                "Set-Cookie",
                f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
            )
        self.end_headers()
        self.wfile.write(response)

    def request_session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(COOKIE_NAME)
        token = morsel.value if morsel else None
        return token if token and re.fullmatch(r"[A-Za-z0-9_-]{43}", token) else None

    def authenticated_user(self, connection):
        token = self.request_session_token()
        if not token:
            return None
        now = int(time.time())
        row = connection.execute(
            """
            SELECT users.user_id, users.display_id
            FROM sessions JOIN users ON users.user_id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_digest(token), now),
        ).fetchone()
        return row

    def handle_auth_status(self):
        with connect_database(self.data_dir) as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))

            user_count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            user = self.authenticated_user(connection)
        self.send_json(
            200,
            {
                "setupRequired": user_count == 0,
                "authenticated": user is not None,
                "user": user_summary(user) if user else None,
            },
        )

    def handle_setup(self, payload):
        display_id, user_id, password = self.valid_credentials(payload)
        salt = secrets.token_bytes(16)
        password_hash = hash_password(password, salt)
        with connect_database(self.data_dir) as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
                self.send_json(409, {"error": "Administrator setup is already complete. Sign in instead."})
                return
            connection.execute(
                "INSERT INTO users (user_id, display_id, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, display_id, salt, password_hash, int(time.time())),
            )
            token = create_session(connection, user_id)
            user = connection.execute("SELECT user_id, display_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
        self.send_json(201, {"authenticated": True, "user": user_summary(user)}, cookie=token)

    def valid_credentials(self, payload):
        display_id = payload.get("userId")
        password = payload.get("password")
        if not isinstance(display_id, str) or not re.fullmatch(r"[A-Za-z0-9._@-]{3,40}", display_id.strip()):
            raise ValueError("User ID must be 3–40 characters using letters, numbers, dot, underscore, @, or hyphen.")
        if not isinstance(password, str) or len(password) < PASSWORD_MIN_LENGTH or len(password) > 256:
            raise ValueError(f"Password must be between {PASSWORD_MIN_LENGTH} and 256 characters.")
        display_id = display_id.strip()
        return display_id, display_id.casefold(), password

    def handle_login(self, payload):
        display_id = payload.get("userId")
        password = payload.get("password")
        if not isinstance(display_id, str) or not isinstance(password, str):
            raise ValueError("Enter your user ID and password.")
        display_id = display_id.strip()
        if not re.fullmatch(r"[A-Za-z0-9._@-]{3,40}", display_id) or len(password) > 256:
            self.send_json(401, {"error": "Invalid user ID or password."})
            return
        key = (self.client_address[0], display_id.casefold())
        now = time.monotonic()
        attempts = [attempt for attempt in LOGIN_ATTEMPTS.get(key, []) if now - attempt < LOGIN_WINDOW_SECONDS]
        if len(attempts) >= LOGIN_LIMIT:
            LOGIN_ATTEMPTS[key] = attempts
            self.send_json(429, {"error": "Too many sign-in attempts. Wait 15 minutes and try again."})
            return

        with connect_database(self.data_dir) as connection:
            user = connection.execute(
                "SELECT user_id, display_id, password_salt, password_hash FROM users WHERE user_id = ?",
                (display_id.casefold(),),
            ).fetchone()
            candidate_hash = hash_password(password, user["password_salt"] if user else bytes(16))
            if not user or not hmac.compare_digest(candidate_hash, user["password_hash"]):
                attempts.append(now)
                LOGIN_ATTEMPTS[key] = attempts
                self.send_json(401, {"error": "Invalid user ID or password."})
                return
            LOGIN_ATTEMPTS.pop(key, None)
            token = create_session(connection, user["user_id"])
        self.send_json(200, {"authenticated": True, "user": user_summary(user)}, cookie=token)

    def handle_logout(self):
        token = self.request_session_token()
        if token:
            with connect_database(self.data_dir) as connection:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))
        self.send_json(200, {"authenticated": False}, clear_cookie=True)

    def log_message(self, format_string, *args):
        if "POST /api/auth/login" in format_string:
            return
        super().log_message(format_string, *args)


class LocalHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="Run the Outdoor Media Management System on this computer.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1; keep local for HTTP).")
    parser.add_argument("--port", type=int, default=8000, help="Local web port (default: 8000).")
    parser.add_argument("--data-dir", type=Path, default=default_data_dir(), help="Directory for the local authentication database.")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        parser.error("The built-in HTTP server only supports loopback addresses. Use HTTPS and a production server for network access.")
    resolved_data_dir = args.data_dir.resolve()
    if resolved_data_dir == ROOT or ROOT in resolved_data_dir.parents:
        parser.error("--data-dir must be outside the web application folder.")
    args.data_dir = resolved_data_dir
    initialize_database(args.data_dir)
    server = LocalHTTPServer((args.host, args.port), ApplicationHandler)
    server.data_dir = args.data_dir
    print(f"Outdoor Media Management System: http://127.0.0.1:{args.port}")
    print(f"Authentication database: {database_path(args.data_dir)}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
