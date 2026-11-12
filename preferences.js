const PREFS_STATUS_DURATION = 5000;
const PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,50}$/;

const unitsStatus = document.getElementById("units-status");
const dashboardStatus = document.getElementById("dashboard-status");
const pageStatus = document.getElementById("prefs-page-status");
const unitRadios = document.querySelectorAll('input[name="temperature_unit"]');
const roomChecks = document.getElementById("room-checks");
const roomChecksMessage = document.getElementById("room-checks-message");

const prefsBackdrop = document.getElementById("prefs-backdrop");

const profileDialog = document.getElementById("profile-dialog");
const profileForm = document.getElementById("profile-form");
const profileError = document.getElementById("profile-dialog-error");
const profileSaveButton = document.getElementById("profile-dialog-save");
const profileUsernameInput = document.getElementById("profile-username");
const profileEmailInput = document.getElementById("profile-email");
const profileNewPasswordInput = document.getElementById("profile-new-password");
const profileConfirmPasswordInput = document.getElementById("profile-confirm-password");
const profileCurrentPasswordInput = document.getElementById("profile-current-password");
const profileUsernameValue = document.getElementById("profile-username-value");
const profileEmailValue = document.getElementById("profile-email-value");

const deleteDialog = document.getElementById("delete-dialog");
const deleteForm = document.getElementById("delete-form");
const deleteError = document.getElementById("delete-dialog-error");
const deleteConfirmButton = document.getElementById("delete-dialog-confirm");
const deletePasswordInput = document.getElementById("delete-current-password");

let savedUnit = document.querySelector('input[name="temperature_unit"]:checked')?.value || "celsius";
let roomCheckboxes = [];
let savedHiddenRooms = [];
let saveQueue = Promise.resolve();
let pageStatusTimer = null;
let returnFocus = null;


function hiddenRoomIds() {
    return roomCheckboxes
        .filter((checkbox) => !checkbox.checked)
        .map((checkbox) => checkbox.value);
}


function setCardStatus(element, message, state = "saved") {
    element.textContent = message;
    element.classList.toggle("is-error", state === "error");
    element.classList.toggle("is-saving", state === "saving");
}


function showPageStatus(message) {
    clearTimeout(pageStatusTimer);

    pageStatus.textContent = message;
    pageStatus.hidden = false;

    pageStatusTimer = setTimeout(() => {
        pageStatus.hidden = true;
        pageStatus.textContent = "";
    }, PREFS_STATUS_DURATION);
}


async function sendJson(url, method, payload) {
    const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
    });

    let data = {};

    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    return { response, data };
}


function errorMessageFor(response, data, fallback) {
    if (response.status === 401) {
        return "Your session has expired. Please sign in again.";
    }

    return data.error || fallback;
}


function savePreferences(payload, statusElement, onSuccess, onFailure) {
    setCardStatus(statusElement, "Saving…", "saving");

    saveQueue = saveQueue.then(async () => {
        try {
            const { response, data } = await sendJson("api/preferences.php", "POST", payload);

            if (!response.ok) {
                onFailure();
                setCardStatus(statusElement, errorMessageFor(response, data, "Could not save. Please try again."), "error");
                return;
            }

            onSuccess(data.preferences);
        } catch (error) {
            onFailure();
            setCardStatus(statusElement, "Could not reach the server. Check your connection and try again.", "error");
        }
    });
}


function unitSymbol(unit) {
    return unit === "fahrenheit" ? "°F" : "°C";
}


unitRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked) return;

        const unit = radio.value;

        savePreferences(
            { temperature_unit: unit },
            unitsStatus,
            (preferences) => {
                savedUnit = preferences.temperature_unit;

                const preferencesElement = document.getElementById("user-preferences");

                if (preferencesElement) {
                    preferencesElement.dataset.temperatureUnit = savedUnit;
                }

                setCardStatus(unitsStatus, `Saved. Temperatures show in ${unitSymbol(savedUnit)}.`);
            },
            () => {
                unitRadios.forEach((other) => {
                    other.checked = other.value === savedUnit;
                });
            }
        );
    });
});


function onRoomToggle(checkbox) {
    const shownCount = roomCheckboxes.filter((other) => other.checked).length;

    if (shownCount === 0) {
        checkbox.checked = true;
        setCardStatus(dashboardStatus, "Keep at least one room on the dashboard.", "error");
        return;
    }

    savePreferences(
        { hidden_rooms: hiddenRoomIds() },
        dashboardStatus,
        (preferences) => {
            savedHiddenRooms = preferences.hidden_rooms;
            const shown = roomCheckboxes.filter((other) => !savedHiddenRooms.includes(other.value)).length;

            setCardStatus(
                dashboardStatus,
                shown === roomCheckboxes.length
                    ? "Saved. The dashboard shows all rooms."
                    : `Saved. The dashboard shows ${shown} of ${roomCheckboxes.length} rooms.`
            );
        },
        () => {
            roomCheckboxes.forEach((other) => {
                other.checked = !savedHiddenRooms.includes(other.value);
            });
        }
    );
}


function createRoomCheck(room) {
    const label = document.createElement("label");
    label.className = "prefs-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "dashboard_rooms";
    checkbox.value = room.id;
    checkbox.checked = !room.hidden;
    checkbox.addEventListener("change", () => onRoomToggle(checkbox));

    const name = document.createElement("span");
    name.className = "prefs-check-label";
    name.textContent = room.name || room.id;

    label.append(checkbox, name);

    return { label, checkbox };
}


async function loadRoomChecks() {
    try {
        const response = await fetch("api/rooms.php?all=1", { credentials: "same-origin" });
        const data = await response.json();

        if (!response.ok || !Array.isArray(data.rooms)) {
            throw new Error(data.error || "Unexpected rooms response.");
        }

        if (data.rooms.length === 0) {
            roomChecksMessage.textContent = "No rooms found in Home Assistant.";
            return;
        }

        const checks = data.rooms.map(createRoomCheck);

        roomCheckboxes = checks.map((check) => check.checkbox);
        savedHiddenRooms = hiddenRoomIds();

        roomChecks.replaceChildren(...checks.map((check) => check.label));
        roomChecks.hidden = false;
        roomChecksMessage.hidden = true;
    } catch (error) {
        console.error(error);
        roomChecksMessage.textContent = "Could not load rooms from Home Assistant. Please try again later.";
    }
}


loadRoomChecks();


function setFieldError(input, message) {
    const errorElement = document.getElementById(`${input.id}-error`);

    if (errorElement) {
        errorElement.textContent = message;
    }

    input.classList.toggle("input-error", message !== "");

    if (message === "") {
        input.removeAttribute("aria-invalid");
    } else {
        input.setAttribute("aria-invalid", "true");
    }
}


function openDialog(dialog, opener, focusTarget) {
    returnFocus = opener;

    prefsBackdrop.hidden = false;
    dialog.hidden = false;
    document.body.classList.add("modal-open");

    focusTarget.focus();
}


function closeDialog(dialog) {
    if (!dialog || dialog.hidden) {
        return;
    }

    dialog.hidden = true;
    prefsBackdrop.hidden = true;
    document.body.classList.remove("modal-open");

    dialog.querySelectorAll('input[type="password"]').forEach((input) => {
        input.value = "";
    });

    if (returnFocus && document.body.contains(returnFocus)) {
        returnFocus.focus();
    }
}


function trapFocus(event, dialog) {
    const focusable = Array.from(dialog.querySelectorAll("button, input"))
        .filter((element) => !element.disabled && element.offsetParent !== null);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}


const profileInputs = [
    profileUsernameInput,
    profileEmailInput,
    profileNewPasswordInput,
    profileConfirmPasswordInput,
    profileCurrentPasswordInput,
];


function clearProfileErrors() {
    profileInputs.forEach((input) => setFieldError(input, ""));
    profileError.hidden = true;
    profileError.textContent = "";
}


function openProfileDialog(opener) {
    clearProfileErrors();

    profileUsernameInput.value = profileUsernameValue.textContent;
    profileEmailInput.value = profileEmailValue.textContent;

    const firstField = profileUsernameInput;

    openDialog(profileDialog, opener, firstField);
}


function validateProfileForm() {
    let valid = true;
    const username = profileUsernameInput.value.trim();

    if (username === "") {
        setFieldError(profileUsernameInput, "Username is required.");
        valid = false;
    } else if (!PROFILE_USERNAME_PATTERN.test(username)) {
        setFieldError(profileUsernameInput, 'Username must be 3-50 characters: letters, numbers, ".", "_" or "-".');
        valid = false;
    }

    if (profileNewPasswordInput.value !== "" || profileConfirmPasswordInput.value !== "") {
        if (profileNewPasswordInput.value.length < 8) {
            setFieldError(profileNewPasswordInput, "Password must be at least 8 characters.");
            valid = false;
        }

        if (profileNewPasswordInput.value !== profileConfirmPasswordInput.value) {
            setFieldError(profileConfirmPasswordInput, "Passwords do not match.");
            valid = false;
        }
    }

    if (profileCurrentPasswordInput.value === "") {
        setFieldError(profileCurrentPasswordInput, "Enter your current password to confirm.");
        valid = false;
    }

    return valid;
}


function showFieldErrors(fields, inputsByName) {
    Object.entries(fields).forEach(([name, message]) => {
        if (inputsByName[name]) {
            setFieldError(inputsByName[name], message);
        }
    });
}


async function saveProfile() {
    const payload = {
        username: profileUsernameInput.value.trim(),
        email: profileEmailInput.value.trim(),
        new_password: profileNewPasswordInput.value,
        confirm_password: profileConfirmPasswordInput.value,
        current_password: profileCurrentPasswordInput.value,
    };

    profileSaveButton.disabled = true;
    profileSaveButton.textContent = "Saving…";

    try {
        const { response, data } = await sendJson("api/account.php", "POST", payload);

        if (!response.ok) {
            const fields = data.fields || {};

            showFieldErrors(fields, {
                username: profileUsernameInput,
                email: profileEmailInput,
                new_password: profileNewPasswordInput,
                confirm_password: profileConfirmPasswordInput,
                current_password: profileCurrentPasswordInput,
            });

            if (Object.keys(fields).length === 0) {
                profileError.textContent = errorMessageFor(response, data, "Could not save your profile. Please try again.");
                profileError.hidden = false;
            }

            return;
        }

        profileUsernameValue.textContent = data.user.username;
        profileEmailValue.textContent = data.user.email;

        document.querySelectorAll(".account-greeting, .account-menu-greeting").forEach((element) => {
            element.textContent = `Hello, ${data.user.username}`;
        });

        closeDialog(profileDialog);
        showPageStatus(data.changed ? "Your profile was saved." : "No changes were made.");
    } catch (error) {
        profileError.textContent = "Could not reach the server. Check your connection and try again.";
        profileError.hidden = false;
    } finally {
        profileSaveButton.disabled = false;
        profileSaveButton.textContent = "Save changes";
    }
}


async function deleteAccount() {
    setFieldError(deletePasswordInput, "");
    deleteError.hidden = true;

    if (deletePasswordInput.value === "") {
        setFieldError(deletePasswordInput, "Enter your password to confirm.");
        deletePasswordInput.focus();
        return;
    }

    deleteConfirmButton.disabled = true;
    deleteConfirmButton.textContent = "Deleting…";

    try {
        const { response, data } = await sendJson("api/account.php", "DELETE", {
            current_password: deletePasswordInput.value,
        });

        if (!response.ok) {
            const fields = data.fields || {};

            if (fields.current_password) {
                setFieldError(deletePasswordInput, fields.current_password);
                deletePasswordInput.focus();
            } else {
                deleteError.textContent = errorMessageFor(response, data, "Could not delete your account. Please try again.");
                deleteError.hidden = false;
            }

            return;
        }

        window.location.href = "login.php";
    } catch (error) {
        deleteError.textContent = "Could not reach the server. Check your connection and try again.";
        deleteError.hidden = false;
    } finally {
        deleteConfirmButton.disabled = false;
        deleteConfirmButton.textContent = "Delete my account";
    }
}


document.getElementById("open-profile-dialog").addEventListener("click", (event) => {
    openProfileDialog(event.currentTarget);
});

document.getElementById("profile-dialog-close").addEventListener("click", () => closeDialog(profileDialog));
document.getElementById("profile-dialog-cancel").addEventListener("click", () => closeDialog(profileDialog));

profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    clearProfileErrors();

    if (validateProfileForm()) {
        saveProfile();
    } else {
        const firstInvalid = profileInputs.find((input) => input.getAttribute("aria-invalid") === "true");

        if (firstInvalid) firstInvalid.focus();
    }
});

if (deleteDialog) {
    document.getElementById("open-delete-dialog").addEventListener("click", (event) => {
        setFieldError(deletePasswordInput, "");
        deleteError.hidden = true;
        openDialog(deleteDialog, event.currentTarget, document.getElementById("delete-dialog-cancel"));
    });

    document.getElementById("delete-dialog-cancel").addEventListener("click", () => closeDialog(deleteDialog));

    deleteForm.addEventListener("submit", (event) => {
        event.preventDefault();
        deleteAccount();
    });
}

prefsBackdrop.addEventListener("click", () => {
    if (deleteConfirmButton && deleteConfirmButton.disabled) return;

    closeDialog(profileDialog);
    closeDialog(deleteDialog);
});

[profileDialog, deleteDialog].filter(Boolean).forEach((dialog) => {
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();

            if (!(deleteConfirmButton && deleteConfirmButton.disabled)) {
                closeDialog(dialog);
            }
        } else if (event.key === "Tab") {
            trapFocus(event, dialog);
        }
    });
});
