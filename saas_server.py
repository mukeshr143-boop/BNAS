
#!/usr/bin/env python3
import argparse
import json
import os
import re
import time
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
ACCESS_COOKIE = "ooh_access"
REFRESH_COOKIE = "ooh_refresh"
MAX_REQUEST_BYTES = 4096
MAX_DATA_REQUEST_BYTES = 1024 * 1024
MAX_FILE_BYTES = 25 * 1024 * 1024
PASSWORD_MIN_LENGTH = 12
LOGIN_LIMIT = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_ATTEMPTS = {}
DATA_COLLECTIONS = {
    "inventory",
    "inventory-photos",
    "presentations",
    "landlord-bank-documents",
    "important-documents",
    "landlord-payments",
    "operations-budgets",
    "bank-master",
}
STORAGE_BUCKET = "workspace-files"


class SupabaseError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def supabase_request(server, path, method="GET", payload=None, access_token=None, prefer=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "apikey": server.supabase_anon_key,
        "Authorization": f"Bearer {access_token or server.supabase_anon_key}",
        "Accept": "application/json",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    request = Request(
        f"{server.supabase_url}/rest/v1/{path}" if path.startswith(("tenants", "tenant_members", "workspace_records")) else f"{server.supabase_url}/auth/v1/{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=15) as response:
            response_body = response.read()
            return response.status, json.loads(response_body) if response_body else None, response.headers
    except HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
            message = details.get("msg") or details.get("message") or details.get("error_description") or details.get("error") or "Supabase request failed."
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = "Supabase request failed."
        raise SupabaseError(error.code, message) from error
    except (URLError, TimeoutError) as error:
        raise SupabaseError(502, "Could not connect to Supabase. Check the project URL and network connection.") from error


def supabase_storage_request(server, path, method, access_token, payload=None, content_type=None, upsert=False):
    headers = {
        "apikey": server.supabase_anon_key,
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    if content_type:
        headers["Content-Type"] = content_type
    if upsert:
        headers["x-upsert"] = "true"
    body = payload
    if isinstance(payload, dict):
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(
        f"{server.supabase_url}/storage/v1/{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=30) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
            message = details.get("message") or details.get("error") or details.get("statusCode") or "Supabase Storage request failed."
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = "Supabase Storage request failed."
        raise SupabaseError(error.code, str(message)) from error
    except (URLError, TimeoutError) as error:
        raise SupabaseError(502, "Could not connect to Supabase Storage. Check the project URL and network connection.") from error


def valid_data_collection(collection):
    if collection not in DATA_COLLECTIONS:
        raise ValueError("Unknown workspace data collection.")
    return collection


def tenant_for_user(server, user_id, access_token, requested_slug=None, email=None):
    query = urlencode({
        "select": "role,tenant_id,tenants(id,slug,name,plan)",
        "user_id": f"eq.{user_id}",
        "limit": "1",
    })
    _, members, _ = supabase_request(server, f"tenant_members?{query}", access_token=access_token)
    if not members:
        return None
    member = members[0]
    tenant = member.get("tenants") or {}
    if requested_slug and tenant.get("slug", "").casefold() != requested_slug.casefold():
        return None
    return {
        "user": {
            "userId": email or user_id,
            "role": member.get("role", "member"),
            "tenant": tenant.get("slug"),
        },
        "tenant": {
            "tenantId": tenant.get("id") or member.get("tenant_id"),
            "slug": tenant.get("slug"),
            "name": tenant.get("name"),
            "plan": tenant.get("plan", "starter"),
        },
    }


class SaaSHandler(SimpleHTTPRequestHandler):
    server_version = "OutdoorMediaSaaS/2.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "geolocation=(self)")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def do_GET(self):
        route = urlsplit(self.path).path
        if route in {"/api/auth/status", "/api/admin/summary"}:
            try:
                self.handle_session_status(summary_only=route == "/api/admin/summary")
            except SupabaseError as error:
                self.log_error("Supabase session request failed.")
                self.send_json(502, {"error": error.args[0]})
            return
        if re.fullmatch(r"/api/data/[^/]+", route):
            self.handle_workspace_data("GET", route)
            return
        if route.startswith("/api/files/"):
            self.handle_workspace_file("GET", route)
            return
        super().do_GET()

    def do_POST(self):
        route = urlsplit(self.path).path
        if re.fullmatch(r"/api/data/[^/]+", route):
            self.handle_workspace_data("POST", route)
            return
        if route.startswith("/api/files/"):
            self.handle_workspace_file("POST", route)
            return
        if route not in {"/api/auth/setup", "/api/auth/login", "/api/auth/logout"}:
            self.send_json(404, {"error": "Not found."})
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
        except SupabaseError as error:
            if error.status in {400, 401, 403, 422}:
                self.send_json(400 if error.status != 401 else 401, {"error": error.args[0]})
            elif error.status == 429:
                self.send_json(429, {"error": "Too many requests. Wait before trying again."})
            else:
                self.log_error("Supabase authentication request failed.")
                self.send_json(502, {"error": error.args[0]})

    def do_PUT(self):
        route = urlsplit(self.path).path
        if re.fullmatch(r"/api/data/[^/]+/[^/]+", route):
            self.handle_workspace_data("PUT", route)
            return
        self.send_json(404, {"error": "Not found."})

    def do_DELETE(self):
        route = urlsplit(self.path).path
        if re.fullmatch(r"/api/data/[^/]+/[^/]+", route):
            self.handle_workspace_data("DELETE", route)
            return
        if route.startswith("/api/files/"):
            self.handle_workspace_file("DELETE", route)
            return
        self.send_json(404, {"error": "Not found."})

    def read_json_body(self, max_bytes=MAX_REQUEST_BYTES):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Expected a JSON request.")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error
        if length <= 0 or length > max_bytes:
            raise ValueError("Request body is missing or too large.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Invalid JSON request.") from error
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object.")
        return payload

    def workspace_context(self):
        access_token = self.cookie_value(ACCESS_COOKIE)
        refresh_token = self.cookie_value(REFRESH_COOKIE)
        refreshed_tokens = None
        if not access_token and refresh_token:
            access_token, refreshed_tokens = self.refresh_session(refresh_token)
        if not access_token:
            raise SupabaseError(401, "Authentication required.")
        try:
            user = self.auth_user(access_token)
        except SupabaseError as error:
            if error.status not in {400, 401} or not refresh_token:
                raise
            access_token, refreshed_tokens = self.refresh_session(refresh_token)
            if not access_token:
                raise SupabaseError(401, "Your session has expired. Sign in again.") from error
            user = self.auth_user(access_token)
        workspace = tenant_for_user(self.server, user["id"], access_token, email=user.get("email"))
        if not workspace:
            raise SupabaseError(403, "No workspace membership is available for this account.")
        return workspace, access_token, refreshed_tokens

    def handle_workspace_data(self, method, route):
        try:
            parts = [unquote(part) for part in route.split("/") if part]
            collection = valid_data_collection(parts[2])
            workspace, access_token, refreshed_tokens = self.workspace_context()
            tenant_id = workspace["tenant"]["tenantId"]
            if method == "GET":
                query = urlencode({
                    "select": "record_id,data",
                    "collection": f"eq.{collection}",
                    "order": "created_at.asc",
                })
                _, rows, _ = supabase_request(
                    self.server, f"workspace_records?{query}", access_token=access_token
                )
                self.send_json(200, {"records": [row["data"] for row in rows or []]}, tokens=refreshed_tokens)
                return

            if method == "DELETE":
                record_id = parts[3]
                self.validate_record_id(record_id)
                query = urlencode({
                    "tenant_id": f"eq.{tenant_id}",
                    "collection": f"eq.{collection}",
                    "record_id": f"eq.{record_id}",
                })
                supabase_request(
                    self.server, f"workspace_records?{query}", method="DELETE",
                    access_token=access_token, prefer="return=minimal",
                )
                self.send_json(200, {"deleted": True}, tokens=refreshed_tokens)
                return

            if method == "POST":
                payload = self.read_json_body(MAX_DATA_REQUEST_BYTES)
                records = payload.get("records")
                if records is None:
                    records = [payload]
                if not isinstance(records, list) or not records or len(records) > 500:
                    raise ValueError("Provide between 1 and 500 workspace records.")
            else:
                payload = self.read_json_body(MAX_DATA_REQUEST_BYTES)
                payload["id"] = parts[3]
                records = [payload]

            rows = []
            for record in records:
                if not isinstance(record, dict):
                    raise ValueError("Every workspace record must be a JSON object.")
                record_id = record.get("id") or record.get("code")
                if not isinstance(record_id, (str, int)) or isinstance(record_id, bool):
                    raise ValueError("Every workspace record must include an id or code.")
                record_id = str(record_id)
                self.validate_record_id(record_id)
                rows.append({
                    "tenant_id": tenant_id,
                    "collection": collection,
                    "record_id": record_id,
                    "data": record,
                })
            query = "workspace_records?" + urlencode({
                "on_conflict": "tenant_id,collection,record_id",
            })
            _, saved, _ = supabase_request(
                self.server, query, method="POST", payload=rows, access_token=access_token,
                prefer="resolution=merge-duplicates,return=representation",
            )
            result = [row["data"] for row in saved or []]
            self.send_json(200, {"records": result}, tokens=refreshed_tokens)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except SupabaseError as error:
            self.send_workspace_error(error)

    @staticmethod
    def validate_record_id(record_id):
        if not isinstance(record_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", record_id):
            raise ValueError("Workspace record id is invalid.")

    def handle_workspace_file(self, method, route):
        try:
            workspace, access_token, refreshed_tokens = self.workspace_context()
            tenant_id = workspace["tenant"]["tenantId"]
            raw_parts = [unquote(part) for part in route.split("/") if part]
            if method == "POST":
                if len(raw_parts) != 4:
                    raise ValueError("File upload path is invalid.")
                collection = valid_data_collection(raw_parts[2])
                record_id = raw_parts[3]
                self.validate_record_id(record_id)
                query = parse_qs(urlsplit(self.path).query)
                requested_name = query.get("filename", [""])[0].replace("\\", "/").rsplit("/", 1)[-1]
                filename = re.sub(r"[^A-Za-z0-9._-]", "_", requested_name).strip("._")
                if not filename or len(filename) > 160:
                    raise ValueError("A valid file name is required.")
                content_type = self.headers.get_content_type()
                if content_type != "application/pdf" and not content_type.startswith("image/"):
                    raise ValueError("Only PDF and image files can be uploaded.")
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError as error:
                    raise ValueError("Invalid file length.") from error
                if length <= 0 or length > MAX_FILE_BYTES:
                    raise ValueError("File must be no larger than 25 MB.")
                file_body = self.rfile.read(length)
                if len(file_body) != length:
                    raise ValueError("File upload was incomplete.")
                storage_path = f"{tenant_id}/{collection}/{record_id}/{filename}"
                target = f"object/{STORAGE_BUCKET}/{quote(storage_path, safe='/')}"
                supabase_storage_request(
                    self.server, target, "POST", access_token, payload=file_body,
                    content_type=content_type, upsert=True,
                )
                self.send_json(201, {"storagePath": storage_path}, tokens=refreshed_tokens)
                return

            if len(raw_parts) != 6 or raw_parts[2] != tenant_id:
                raise ValueError("File path is invalid for this workspace.")
            collection = valid_data_collection(raw_parts[3])
            record_id = raw_parts[4]
            self.validate_record_id(record_id)
            filename = raw_parts[5]
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,160}", filename):
                raise ValueError("File name is invalid.")
            storage_path = f"{tenant_id}/{collection}/{record_id}/{filename}"
            if method == "GET":
                target = f"object/authenticated/{STORAGE_BUCKET}/{quote(storage_path, safe='/')}"
                _, file_body, headers = supabase_storage_request(
                    self.server, target, "GET", access_token,
                )
                self.send_response(200)
                self.send_header("Content-Type", headers.get("Content-Type", "application/octet-stream"))
                self.send_header("Content-Length", str(len(file_body)))
                self.send_header("Cache-Control", "no-store")
                self.send_session_cookies(tokens=refreshed_tokens)
                self.end_headers()
                self.wfile.write(file_body)
                return
            target = "object/delete"
            supabase_storage_request(
                self.server, target, "POST", access_token,
                payload={"bucketId": STORAGE_BUCKET, "prefixes": [storage_path]},
            )
            self.send_json(200, {"deleted": True}, tokens=refreshed_tokens)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except SupabaseError as error:
            self.send_workspace_error(error)

    def send_workspace_error(self, error):
        status = error.status if error.status in {400, 401, 403, 404, 409, 413, 429} else 502
        if status >= 500:
            self.log_error("Supabase workspace data request failed.")
        self.send_json(status, {"error": error.args[0]}, clear_cookies=status == 401)

    def send_json(self, status, payload, tokens=None, clear_cookies=False):
        response = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(response)))
        self.send_session_cookies(tokens=tokens, clear_cookies=clear_cookies)
        self.end_headers()
        self.wfile.write(response)

    def send_session_cookies(self, tokens=None, clear_cookies=False):
        secure = "; Secure" if self.server.secure_cookies else ""
        if tokens:
            expires = max(60, min(int(tokens.get("expires_in", 3600)), 86400))
            self.send_header(
                "Set-Cookie",
                f"{ACCESS_COOKIE}={tokens['access_token']}; Path=/; HttpOnly; SameSite=Lax; Max-Age={expires}{secure}",
            )
            self.send_header(
                "Set-Cookie",
                f"{REFRESH_COOKIE}={tokens['refresh_token']}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000{secure}",
            )
        elif clear_cookies:
            for name in (ACCESS_COOKIE, REFRESH_COOKIE):
                self.send_header("Set-Cookie", f"{name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")

    def cookie_value(self, cookie_name):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get(cookie_name)
        return morsel.value if morsel else None

    def auth_user(self, access_token):
        _, user, _ = supabase_request(self.server, "user", access_token=access_token)
        return user

    def handle_session_status(self, summary_only=False):
        access_token = self.cookie_value(ACCESS_COOKIE)
        refresh_token = self.cookie_value(REFRESH_COOKIE)
        refreshed_tokens = None
        if not access_token and refresh_token:
            access_token, refreshed_tokens = self.refresh_session(refresh_token)
        if access_token:
            try:
                user = self.auth_user(access_token)
                workspace = tenant_for_user(self.server, user["id"], access_token, email=user.get("email"))
                if workspace:
                    summary = self.workspace_summary(workspace, access_token)
                    result = {"authenticated": True, "setupRequired": False, "saas": True, **workspace, "summary": summary}
                    self.send_json(200, result, tokens=refreshed_tokens)
                    return
            except SupabaseError as error:
                if error.status in {400, 401} and refresh_token:
                    access_token, refreshed_tokens = self.refresh_session(refresh_token)
                    if access_token:
                        try:
                            user = self.auth_user(access_token)
                            workspace = tenant_for_user(self.server, user["id"], access_token, email=user.get("email"))
                            if workspace:
                                summary = self.workspace_summary(workspace, access_token)
                                result = {"authenticated": True, "setupRequired": False, "saas": True, **workspace, "summary": summary}
                                self.send_json(200, result, tokens=refreshed_tokens)
                                return
                        except SupabaseError as refresh_error:
                            if refresh_error.status not in {400, 401, 403}:
                                self.send_json(502, {"error": refresh_error.args[0]})
                                return
                elif error.status not in {400, 401, 403}:
                    self.send_json(502, {"error": error.args[0]})
                    return
        if summary_only:
            self.send_json(401, {"error": "Authentication required."}, clear_cookies=bool(access_token or refresh_token))
            return
        result = {"setupRequired": False, "authenticated": False, "saas": True, "user": None, "tenant": None}
        self.send_json(200, result, clear_cookies=bool(access_token or refresh_token))

    def refresh_session(self, refresh_token):
        try:
            _, tokens, _ = supabase_request(
                self.server,
                "token?grant_type=refresh_token",
                method="POST",
                payload={"refresh_token": refresh_token},
            )
            return tokens.get("access_token"), tokens
        except SupabaseError as error:
            if error.status in {400, 401}:
                return None, None
            raise

    def handle_logout(self):
        access_token = self.cookie_value(ACCESS_COOKIE)
        if access_token:
            try:
                supabase_request(
                    self.server,
                    "logout?scope=local",
                    method="POST",
                    access_token=access_token,
                )
            except SupabaseError as error:
                if error.status not in {400, 401}:
                    raise
        self.send_json(200, {"authenticated": False, "saas": True}, clear_cookies=True)

    def workspace_summary(self, workspace, access_token):
        tenant_id = workspace["tenant"]["tenantId"]
        query = urlencode({"select": "user_id", "tenant_id": f"eq.{tenant_id}"})
        _, members, headers = supabase_request(
            self.server,
            f"tenant_members?{query}",
            access_token=access_token,
            prefer="count=exact",
        )
        content_range = headers.get("Content-Range", "")
        total = re.search(r"/(\d+|\*)$", content_range)
        member_count = int(total.group(1)) if total and total.group(1) != "*" else len(members or [])
        return {"memberCount": member_count}

    def handle_setup(self, payload):
        company_name = payload.get("companyName")
        email = payload.get("email") or payload.get("userId")
        password = payload.get("password")
        tenant_slug = payload.get("tenantSlug")
        if not isinstance(company_name, str) or not 2 <= len(company_name.strip()) <= 80:
            raise ValueError("Organization name must be between 2 and 80 characters.")
        if not isinstance(tenant_slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", tenant_slug.strip().lower()):
            raise ValueError("Tenant slug must use lowercase letters, numbers, and single hyphens.")
        self.validate_email_password(email, password)
        _, result, _ = supabase_request(
            self.server,
            "signup",
            method="POST",
            payload={
                "email": email.strip().lower(),
                "password": password,
                "data": {
                    "tenant_name": company_name.strip(),
                    "tenant_slug": tenant_slug.strip().lower(),
                },
            },
        )
        if not result.get("access_token"):
            self.send_json(201, {
                "authenticated": False,
                "verificationRequired": True,
                "message": "Check your email to confirm the account, then sign in.",
            })
            return
        tokens = result
        user = result.get("user") or {}
        workspace = tenant_for_user(self.server, user.get("id"), tokens["access_token"], email=user.get("email"))
        if not workspace:
            self.send_json(503, {"error": "Supabase created the account but did not create its workspace membership. Check the tenant setup SQL and trigger."}, clear_cookies=True)
            return
        self.send_json(
            201,
            {"authenticated": True, "saas": True, **workspace, "summary": self.workspace_summary(workspace, tokens["access_token"])},
            tokens=tokens,
        )

    def validate_email_password(self, email, password):
        if not isinstance(email, str) or len(email.strip()) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email.strip()):
            raise ValueError("Enter a valid email address.")
        if not isinstance(password, str) or len(password) < PASSWORD_MIN_LENGTH or len(password) > 256:
            raise ValueError(f"Password must be between {PASSWORD_MIN_LENGTH} and 256 characters.")

    def handle_login(self, payload):
        email = payload.get("email") or payload.get("userId")
        password = payload.get("password")
        tenant_slug = payload.get("tenantSlug")
        self.validate_email_password(email, password)
        if tenant_slug is not None and not isinstance(tenant_slug, str):
            raise ValueError("Tenant slug must be text.")
        key = (self.client_address[0], email.strip().casefold())
        now = time.monotonic()
        attempts = [attempt for attempt in LOGIN_ATTEMPTS.get(key, []) if now - attempt < LOGIN_WINDOW_SECONDS]
        if len(attempts) >= LOGIN_LIMIT:
            LOGIN_ATTEMPTS[key] = attempts
            self.send_json(429, {"error": "Too many sign-in attempts. Wait 15 minutes and try again."})
            return
        try:
            _, tokens, _ = supabase_request(
                self.server,
                "token?grant_type=password",
                method="POST",
                payload={"email": email.strip().lower(), "password": password},
            )
        except SupabaseError as error:
            if error.status in {400, 401}:
                attempts.append(now)
                LOGIN_ATTEMPTS[key] = attempts
                self.send_json(401, {"error": "Invalid email or password."})
                return
            raise
        user = tokens.get("user") or {}
        workspace = tenant_for_user(self.server, user.get("id"), tokens["access_token"], tenant_slug, user.get("email"))
        if not workspace:
            self.send_json(403, {"error": "This account does not belong to that workspace."}, clear_cookies=True)
            return
        LOGIN_ATTEMPTS.pop(key, None)
        self.send_json(
            200,
            {"authenticated": True, "saas": True, **workspace, "summary": self.workspace_summary(workspace, tokens["access_token"])},
            tokens=tokens,
        )


class SaaSHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser(description="Run the Outdoor Media Management System with Supabase.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1).")
    parser.add_argument("--port", type=int, default=8000, help="Web port (default: 8000).")
    parser.add_argument("--secure-cookies", action="store_true", help="Set Secure cookies when served behind HTTPS.")
    args = parser.parse_args()
    supabase_url = os.environ.get(
        "SUPABASE_URL",
        "https://iiawdwwwsrqeasockvjh.supabase.co",
    ).strip().rstrip("/")
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not supabase_anon_key:
        parser.error("Set SUPABASE_ANON_KEY to your Supabase publishable/anon key before starting. Never use a service_role key.")
    parsed_url = urlsplit(supabase_url)
    if not parsed_url.hostname or parsed_url.path or parsed_url.query or parsed_url.fragment:
        parser.error("SUPABASE_URL must be a Supabase project origin without a path.")
    if parsed_url.scheme != "https" and not (
        parsed_url.scheme == "http" and parsed_url.hostname in {"localhost", "127.0.0.1"}
    ):
        parser.error("SUPABASE_URL must use HTTPS, except for a local Supabase CLI URL.")
    server = SaaSHTTPServer((args.host, args.port), SaaSHandler)
    server.supabase_url = supabase_url
    server.supabase_anon_key = supabase_anon_key
    server.secure_cookies = args.secure_cookies
    print(f"Outdoor Media SaaS app: http://{args.host}:{args.port}")
    print(f"Supabase project: {supabase_url}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping SaaS server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
