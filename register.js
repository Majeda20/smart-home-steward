const registerForm = document.querySelector(".register-form");

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirm-password");

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


function validateUsername() {
    const username = usernameInput.value.trim();

    if (username === "") {
        showError(usernameInput, "Username is required.");
        return false;
    }

    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
        showError(
            usernameInput,
            'Username must be 3-50 characters: letters, numbers, ".", "_" or "-".'
        );

        return false;
    }

    clearError(usernameInput);
    return true;
}


function validatePassword() {
    if (passwordInput.value === "") {
        showError(passwordInput, "Password is required.");
        return false;
    }

    if (passwordInput.value.length < 8) {
        showError(passwordInput, "Password must be at least 8 characters.");
        return false;
    }

    if (passwordInput.value.length > 72) {
        showError(passwordInput, "Password can be at most 72 characters.");
        return false;
    }

    clearError(passwordInput);
    return true;
}


function validateConfirmPassword() {
    if (confirmPasswordInput.value === "") {
        showError(
            confirmPasswordInput,
            "Please confirm your password."
        );

        return false;
    }

    if (passwordInput.value !== confirmPasswordInput.value) {
        showError(
            confirmPasswordInput,
            "Passwords do not match."
        );

        return false;
    }

    clearError(confirmPasswordInput);
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


usernameInput.addEventListener("input", () => {
    if (usernameInput.classList.contains("input-error")) {
        validateUsername();
    }
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

    if (confirmPasswordInput.value !== "") {
        validateConfirmPassword();
    }

});


confirmPasswordInput.addEventListener("input", () => {
    validateConfirmPassword();
});


registerForm.addEventListener("submit", (event) => {

    const usernameValid = validateUsername();
    // const emailValid = validateEmail();
    const passwordValid = validatePassword();
    const confirmPasswordValid = validateConfirmPassword();

    if (
        !usernameValid ||
        !passwordValid ||
        !confirmPasswordValid
    ) {
        event.preventDefault();
    }

});