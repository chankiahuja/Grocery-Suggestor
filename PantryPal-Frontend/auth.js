// Frontend demonstration only. Replace this simulated flow with a server-side
// OTP provider before enabling real authentication. Never verify real OTPs here.
const isSignup = document.body.dataset.authMode === 'signup';
const fullName = document.querySelector('#fullName');
const identityForm = document.querySelector('#identityForm');
const otpForm = document.querySelector('#otpForm');
const identifier = document.querySelector('#identifier');
const otp = document.querySelector('#otp');
const resend = document.querySelector('#resend');
let method = 'mobile';
let cooldown;
let expiresAt = 0;
function errorFor(input, message) {
  document.querySelector('#' + input.id + 'Error').textContent = message;
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}
function identifierError(value) {
  value = value.trim();
  if (!value) return method === 'mobile' ? 'Enter your mobile number.' : 'Enter your email address.';
  if (method === 'mobile' && !/^[0-9]{10}$/.test(value)) return 'Enter exactly 10 digits, without +91 or spaces.';
  if (method === 'email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || !identifier.validity.valid)) return 'Enter a valid email address, such as you@example.com.';
  return '';
}
function startCooldown() {
  clearInterval(cooldown);
  const readyAt = Date.now() + 30000;
  resend.disabled = true;
  resend.textContent = 'Resend in 30s';
  cooldown = setInterval(() => {
    const seconds = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
    resend.textContent = seconds ? 'Resend in ' + seconds + 's' : 'Resend code';
    resend.disabled = seconds > 0;
    if (!seconds) clearInterval(cooldown);
  }, 1000);
}
function showIdentity(focus = true) {
  clearInterval(cooldown);
  expiresAt = 0;
  otp.value = '';
  errorFor(otp, '');
  document.querySelector('#success').hidden = true;
  document.querySelector('#demoNotice').hidden = false;
  document.querySelector('#resendStatus').textContent = '';
  identityForm.hidden = false;
  otpForm.hidden = true;
  document.querySelector('#heading').textContent = isSignup ? 'A little more together.' : 'Welcome home.';
  document.querySelector('#subtitle').textContent = isSignup ? 'Create your account. Make room for simpler days.' : 'Your email or mobile. No password to remember.';
  if (focus) identifier.focus();
}
function setMethod(next) {
  method = next;
  showIdentity(false);
  identifier.value = '';
  identifier.type = method === 'email' ? 'email' : 'tel';
  identifier.inputMode = method === 'email' ? 'email' : 'numeric';
  identifier.autocomplete = method === 'email' ? 'email' : 'tel-national';
  identifier.placeholder = method === 'email' ? 'you@example.com' : '9876543210';
  document.querySelector('#identifierLabel').textContent = method === 'email' ? 'Email address' : 'Mobile number';
  document.querySelector('#identifierHint').textContent = method === 'email' ? 'We’ll use a one-time code to confirm your email.' : 'India · Enter your 10-digit mobile number.';
  document.querySelector('#phonePrefix').hidden = method === 'email';
  document.querySelector('#identifierWrap').classList.toggle('has-prefix', method === 'mobile');
  document.querySelectorAll('[data-method]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.method === method)));
  errorFor(identifier, '');
}
document.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => setMethod(button.dataset.method)));
if (fullName) {
  fullName.addEventListener('blur', () => errorFor(fullName, fullName.value.trim() ? '' : 'Enter your name.'));
  fullName.addEventListener('input', () => { if (fullName.getAttribute('aria-invalid') === 'true') errorFor(fullName, fullName.value.trim() ? '' : 'Enter your name.'); });
}
identifier.addEventListener('blur', () => errorFor(identifier, identifierError(identifier.value)));
identifier.addEventListener('input', () => { if (identifier.getAttribute('aria-invalid') === 'true') errorFor(identifier, identifierError(identifier.value)); });
identityForm.addEventListener('submit', event => {
  event.preventDefault();
  const nameMissing = isSignup && !fullName.value.trim();
  if (isSignup) errorFor(fullName, nameMissing ? 'Enter your name.' : '');
  const message = identifierError(identifier.value);
  errorFor(identifier, message);
  if (nameMissing || message) { (nameMissing ? fullName : identifier).focus(); return; }
  identifier.value = identifier.value.trim();
  identityForm.hidden = true;
  otpForm.hidden = false;
  document.querySelector('#heading').textContent = 'A little check. Then home.';
  document.querySelector('#subtitle').textContent = method === 'email' ? 'Confirm your email address to ' + (isSignup ? 'create your account.' : 'sign in.') : 'Confirm your mobile number to ' + (isSignup ? 'create your account.' : 'sign in.');
  document.querySelector('#numberSummary').textContent = method === 'email' ? identifier.value : '+91 ' + identifier.value.slice(0,5) + ' ' + identifier.value.slice(5);
  document.querySelector('#changeIdentifier').textContent = method === 'email' ? 'Change email' : 'Change number';
  expiresAt = Date.now() + 300000;
  startCooldown();
  otp.focus();
});
otp.addEventListener('input', () => errorFor(otp, ''));
otpForm.addEventListener('submit', event => {
  event.preventDefault();
  const code = otp.value.trim();
  let message = '';
  if (!code) message = 'Enter the verification code.';
  else if (!/^[0-9]{6}$/.test(code)) message = 'Enter a 6-digit verification code.';
  else if (Date.now() > expiresAt) message = 'This demo code has expired. Request another code.';
  else if (code !== '123456') message = 'That code does not match. For this preview, use 123456.';
  errorFor(otp, message);
  if (message) { otp.focus(); return; }
  expiresAt = 0;
  clearInterval(cooldown);
  otp.value = '';
  otpForm.hidden = true;
  document.querySelector('#demoNotice').hidden = true;
  document.querySelector('#heading').textContent = isSignup ? 'Your next chapter starts here.' : 'Make room for the everyday.';
  document.querySelector('#subtitle').textContent = 'Your household essentials, a little more together.';
  document.querySelector('#success').hidden = false;
  document.querySelector('#success').focus();
});
resend.addEventListener('click', () => {
  expiresAt = Date.now() + 300000;
  otp.value = '';
  errorFor(otp, '');
  document.querySelector('#resendStatus').textContent = 'A fresh demo code is ready: 123456. No ' + (method === 'email' ? 'email' : 'SMS') + ' was sent.';
  startCooldown();
  otp.focus();
});
document.querySelector('#changeIdentifier').addEventListener('click', () => showIdentity());
document.querySelector('#startAgain').addEventListener('click', () => showIdentity());
