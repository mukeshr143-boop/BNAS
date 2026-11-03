const authElements = {
  form: document.getElementById('auth-form'),
  title: document.getElementById('auth-title'),
  description: document.getElementById('auth-description'),
  submit: document.getElementById('auth-submit'),
  modeToggle: document.getElementById('auth-mode-toggle'),
  companyField: document.getElementById('auth-company-field'),
  companyName: document.getElementById('auth-company-name'),
  tenantField: document.getElementById('auth-tenant-field'),
  tenantSlug: document.getElementById('auth-tenant-slug'),
  email: document.getElementById('auth-user-id'),
  password: document.getElementById('auth-password'),
  passwordHelp: document.getElementById('auth-password-help'),
  passwordConfirm: document.getElementById('auth-password-confirm'),
  confirmField: document.getElementById('auth-confirm-field'),
  message: document.getElementById('auth-message'),
  logout: document.getElementById('logout-button')
};

let authMode = 'login';
window.workspaceAuthState = { authenticated: false, saas: false };

function showAuthMessage(message, isError = true) {
  authElements.message.textContent = message;
  authElements.message.classList.toggle('auth-message-error', isError);
  authElements.message.classList.toggle('auth-message-success', !isError);
  authElements.message.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const isSetup = mode === 'setup';
  authElements.title.textContent = isSetup ? 'Create a SaaS workspace' : 'Sign in';
  authElements.description.textContent = isSetup
    ? 'Set up your organization, tenant slug, and first admin account.'
    : 'Enter your tenant slug, email, and password to continue.';
  authElements.submit.textContent = isSetup ? 'Create workspace & sign in' : 'Sign in';
  authElements.modeToggle.textContent = isSetup ? 'Already have an account? Sign in' : 'Create a new workspace';
  authElements.password.autocomplete = isSetup ? 'new-password' : 'current-password';
  authElements.companyField.hidden = !isSetup;
  authElements.companyName.required = isSetup;
  authElements.tenantField.hidden = false;
  authElements.tenantSlug.required = false;
  authElements.tenantSlug.readOnly = isSetup;
  authElements.tenantSlug.placeholder = isSetup ? 'auto-generated-from-name' : 'workspace-name';
  authElements.confirmField.hidden = !isSetup;
  authElements.passwordConfirm.required = isSetup;
  authElements.password.minLength = isSetup ? 12 : 1;
  authElements.passwordConfirm.minLength = 12;
  authElements.passwordHelp.hidden = !isSetup;
  authElements.submit.disabled = false;
  showAuthMessage('');
}

async function refreshWorkspaceSummary() {
  try {
    const response = await requestAuth('/api/admin/summary');
    const tenant = response?.tenant || {};
    const summary = response?.summary || {};
    const workspaceName = document.getElementById('workspace-name');
    const workspaceSlug = document.getElementById('workspace-slug');
    const workspacePlan = document.getElementById('workspace-plan');
    const workspaceUsers = document.getElementById('workspace-users');
    if (workspaceName) workspaceName.textContent = tenant.name || 'Workspace';
    if (workspaceSlug) workspaceSlug.textContent = tenant.slug || '-';
    if (workspacePlan) workspacePlan.textContent = tenant.plan || 'starter';
    if (workspaceUsers) workspaceUsers.textContent = summary.memberCount ? String(summary.memberCount) : '1';
  } catch (error) {
    console.warn('Workspace summary unavailable:', error);
  }
}

function setAuthenticated(user, tenant, saas = true) {
  const displayId = user?.userId || 'Administrator';
  const initials = displayId.slice(0, 2).toUpperCase();
  const roleLabel = user?.role ? user.role.toUpperCase() : 'ADMIN';
  const tenantName = tenant?.name || tenant?.slug || 'Workspace';
  document.getElementById('sidebar-user-name').textContent = displayId;
  document.getElementById('sidebar-user-role').textContent = `${tenantName} · ${roleLabel}`;
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('topbar-avatar').textContent = initials;
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    pageTitle.textContent = `Good morning, ${displayId} ✦`;
  }
  const pageSubtitle = document.getElementById('page-subtitle');
  if (pageSubtitle) {
    pageSubtitle.textContent = `${tenantName} workspace · ${roleLabel} access`;
  }
  document.body.classList.add('authenticated');
  document.getElementById('login-screen').hidden = true;
  window.workspaceAuthState = {
    authenticated: true,
    saas,
    tenantId: tenant?.tenantId,
    tenantName: tenant?.name || tenant?.slug
  };
  const dataSourceLabel = document.querySelector('.sample-label');
  if (dataSourceLabel) dataSourceLabel.innerHTML = `<span></span> ${saas ? 'Shared workspace' : 'Sample data'}`;
  window.dispatchEvent(new Event('workspace-authenticated'));
  refreshWorkspaceSummary();
}

function setUnauthenticated() {
  window.workspaceAuthState = { authenticated: false, saas: false };
  window.dispatchEvent(new Event('workspace-unauthenticated'));
  document.body.classList.remove('authenticated');
  document.getElementById('login-screen').hidden = false;
  authElements.companyName.value = '';
  authElements.tenantSlug.value = '';
  authElements.password.value = '';
  authElements.passwordConfirm.value = '';
  authElements.email.focus();
}

async function requestAuth(path, payload) {
  const response = await fetch(path, {
    method: payload ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: payload ? { 'Content-Type': 'application/json' } : {},
    body: payload ? JSON.stringify(payload) : undefined
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('The local authentication server returned an invalid response.');
  }
  if (!response.ok) throw new Error(result.error || 'Authentication failed.');
  return result;
}

async function initializeAuthentication() {
  try {
    const state = await requestAuth('/api/auth/status');
    if (state.authenticated) {
      setAuthenticated(state.user, state.tenant, state.saas);
      return;
    }
    setAuthMode('login');
    document.getElementById('login-screen').hidden = false;
  } catch (error) {
    setAuthMode('login');
    showAuthMessage(`${error.message} Start the SaaS app with Supabase configuration.`);
    authElements.submit.disabled = true;
    document.getElementById('login-screen').hidden = false;
  }
}

authElements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showAuthMessage('');
  authElements.submit.disabled = true;
  const email = authElements.email.value.trim();
  const password = authElements.password.value;
  try {
    if (authMode === 'setup' && password !== authElements.passwordConfirm.value) {
      throw new Error('The passwords do not match.');
    }
    const payload = { email, userId: email, password };
    const tenantSlug = authElements.tenantSlug.value.trim();
    if (tenantSlug) payload.tenantSlug = tenantSlug;
    if (authMode === 'setup') {
      payload.companyName = authElements.companyName.value.trim();
      if (!payload.tenantSlug) {
        payload.tenantSlug = payload.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
      }
    }
    const response = await requestAuth(
      authMode === 'setup' ? '/api/auth/setup' : '/api/auth/login',
      payload
    );
    if (response.verificationRequired) {
      setAuthMode('login');
      showAuthMessage(response.message, false);
      authElements.password.value = '';
      return;
    }
    setAuthenticated(response.user, response.tenant, response.saas);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    authElements.submit.disabled = false;
  }
});

authElements.modeToggle.addEventListener('click', () => {
  setAuthMode(authMode === 'setup' ? 'login' : 'setup');
});

authElements.logout.addEventListener('click', async () => {
  authElements.logout.disabled = true;
  try {
    await requestAuth('/api/auth/logout', {});
    setUnauthenticated();
    setAuthMode('login');
  } catch (error) {
    showToast(`Unable to sign out: ${error.message}`);
  } finally {
    authElements.logout.disabled = false;
  }
});

initializeAuthentication();
