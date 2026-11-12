const loginForm = document.querySelector(".login-form");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");

const passwordToggles = document.querySelectorAll(".password-toggle");


function showError(input, message) {
    const errorElement = document.getElementById(`${input.id}-error`);

    input.classList.add("input-error");
    input.setAttribute("aria-invalid", "true");

    errorElement.textContent = message;
}


function clearError(input) {
    const errorElement = document.getElementById(`${input.id}-error`);

    input.classList.remove("input-error");
    input.removeAttribute("aria-invalid");

    errorElement.textContent = "";
}


function validateEmail() {
    const email = emailInput.value.trim();

    if (email === "") {
        showError(emailInput, "Email is required.");
        return false;
    }

    if (!emailInput.checkValidity()) {
        showError(emailInput, "Please enter a valid email address.");
        return false;
    }

    clearError(emailInput);
    return true;
}


function validatePassword() {
    if (passwordInput.value === "") {
        showError(passwordInput, "Password is required.");
        return false;
    }

    clearError(passwordInput);
    return true;
}


passwordToggles.forEach((toggle) => {

    toggle.addEventListener("click", () => {

        const input = toggle.previousElementSibling;

        if (input.type === "password") {
            input.type = "text";
            toggle.setAttribute("aria-label", "Hide password");
        } else {
            input.type = "password";
            toggle.setAttribute("aria-label", "Show password");
        }

    });

});


emailInput.addEventListener("input", () => {
    if (emailInput.classList.contains("input-error")) {
        validateEmail();
    }
});


passwordInput.addEventListener("input", () => {
    if (passwordInput.classList.contains("input-error")) {
        validatePassword();
    }
});


loginForm.addEventListener("submit", (event) => {

    const emailValid = validateEmail();
    const passwordValid = validatePassword();

    if (!emailValid || !passwordValid) {
        event.preventDefault();
    }

});
