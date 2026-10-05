const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setError(input, message) {
  const error = document.querySelector(`[data-error-for="${input.id}"]`);
  input.classList.toggle("input-error", Boolean(message));

  if (error) {
    error.textContent = message;
  }
}

function validateEmail(input) {
  const value = input.value.trim();

  if (!value) {
    setError(input, "Ingresa tu correo.");
    return false;
  }

  if (!emailPattern.test(value)) {
    setError(input, "Ingresa un correo valido.");
    return false;
  }

  setError(input, "");
  return true;
}

function validatePassword(input) {
  if (!input.value) {
    setError(input, "Ingresa tu contrasena.");
    return false;
  }

  if (input.value.length < 6) {
    setError(input, "La contrasena debe tener al menos 6 caracteres.");
    return false;
  }

  setError(input, "");
  return true;
}

function validateRequiredText(input) {
  if (input.value.trim().length < 2) {
    setError(input, "Ingresa al menos 2 caracteres.");
    return false;
  }

  setError(input, "");
  return true;
}

function validatePasswordMatch(passwordInput, confirmInput) {
  if (!validatePassword(confirmInput)) {
    return false;
  }

  if (passwordInput.value !== confirmInput.value) {
    setError(confirmInput, "Las contrasenas no coinciden.");
    return false;
  }

  setError(confirmInput, "");
  return true;
}

function handleLogin() {
  const form = document.querySelector("#login-form");

  if (!form) {
    return;
  }

  const email = form.querySelector("#login-email");
  const password = form.querySelector("#login-password");
  const status = document.querySelector("#login-status");
  const googleButton = document.querySelector("#google-login");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const isValid = validateEmail(email) && validatePassword(password);

    if (!isValid) {
      status.textContent = "";
      return;
    }

    status.textContent = "Ingresando...";

    const { error } = await db.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value
    });

    if (error) {
      status.textContent = error.message;
      return;
    }

    window.location.href = "perfil.html";
  });

  if (googleButton) {
    googleButton.addEventListener("click", async () => {
      const { error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getRedirectUrl("perfil.html"),
          queryParams: {
            access_type: "offline",
            prompt: "consent"
          }
        }
      });

      if (error) {
        status.textContent = error.message;
      }
    });
  }
}

function handleRegister() {
  const form = document.querySelector("#register-form");

  if (!form) {
    return;
  }

  const name = form.querySelector("#register-name");
  const email = form.querySelector("#register-email");
  const role = form.querySelector("#register-role");
  const password = form.querySelector("#register-password");
  const confirmPassword = form.querySelector("#register-confirm-password");
  const status = document.querySelector("#register-status");
  const googleButton = document.querySelector("#google-register");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const isValidName = validateRequiredText(name);
    const isValidEmail = validateEmail(email);
    const isValidPassword = validatePassword(password);
    const passwordsMatch = validatePasswordMatch(password, confirmPassword);

    if (!isValidName || !isValidEmail || !isValidPassword || !passwordsMatch) {
      status.textContent = "";
      return;
    }

    status.textContent = "Creando cuenta...";

    const { error } = await db.auth.signUp({
      email: email.value.trim(),
      password: password.value,
      options: {
        data: {
          full_name: name.value.trim(),
          role: role.value
        }
      }
    });

    if (error) {
      status.textContent = error.message;
      return;
    }

    status.textContent = "Cuenta creada. Revisa tu correo si Supabase pide confirmacion.";
  });

  if (googleButton) {
    googleButton.addEventListener("click", async () => {
      localStorage.setItem("aurum_pending_google_role", role.value || "usuario");

      const { error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: getRedirectUrl("perfil.html"),
          queryParams: {
            access_type: "offline",
            prompt: "consent"
          }
        }
      });

      if (error) {
        status.textContent = error.message;
      }
    });
  }
}

handleLogin();
handleRegister();
