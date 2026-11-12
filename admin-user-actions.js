const EDIT_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,50}$/;
const EDIT_STATUS_DURATION = 5000;

const editModal = document.getElementById("user-edit");
const editBackdrop = document.getElementById("user-edit-backdrop");
const editForm = document.getElementById("user-edit-form");
const editTitle = document.getElementById("user-edit-title");
const editError = document.getElementById("user-edit-error");
const editIdInput = document.getElementById("user-edit-id");
const editUsernameInput = document.getElementById("user-edit-username");
const editEmailInput = document.getElementById("user-edit-email");
const editRoleSelect = document.getElementById("user-edit-role");
const editRoleHint = document.getElementById("user-edit-role-hint");
const editCancelButton = document.getElementById("user-edit-cancel");
const editSaveButton = document.getElementById("user-edit-save");
const editStatus = document.getElementById("user-edit-status");

const deleteDialog = document.getElementById("user-delete");
const deleteTitle = document.getElementById("user-delete-title");
const deleteText = document.getElementById("user-delete-text");
const deleteError = document.getElementById("user-delete-error");
const deleteCancelButton = document.getElementById("user-delete-cancel");
const deleteConfirmButton = document.getElementById("user-delete-confirm");

const currentUserId = editModal.dataset.currentUserId;

let actionReturnFocus = null;
let editOriginalRole = "";
let editStatusTimer = null;
let deleteTarget = null;


function setFieldError(input, message) {
    const errorElement = document.getElementById(`${input.id}-error`);

    errorElement.textContent = message;
    input.classList.toggle("input-error", message !== "");

    if (message === "") {
        input.removeAttribute("aria-invalid");
    } else {
        input.setAttribute("aria-invalid", "true");
    }
}


function clearEditErrors() {
    [editUsernameInput, editEmailInput, editRoleSelect].forEach((input) => setFieldError(input, ""));
    editError.hidden = true;
    editError.textContent = "";
}


function showEditError(message) {
    editError.textContent = message;
    editError.hidden = false;
}


function showEditStatus(message, isError = false) {
    clearTimeout(editStatusTimer);

    editStatus.textContent = message;
    editStatus.classList.toggle("admin-message-success", !isError);
    editStatus.classList.toggle("admin-message-error", isError);
    editStatus.hidden = false;

    editStatusTimer = setTimeout(() => {
        editStatus.hidden = true;
        editStatus.textContent = "";
    }, EDIT_STATUS_DURATION);
}


function openDialog(dialog, returnFocus, focusTarget) {
    actionReturnFocus = returnFocus;

    editBackdrop.hidden = false;
    dialog.hidden = false;
    document.body.classList.add("modal-open");

    focusTarget.focus();
}


function closeDialog(dialog) {
    if (dialog.hidden) {
        return;
    }

    dialog.hidden = true;
    editBackdrop.hidden = true;
    document.body.classList.remove("modal-open");

    if (actionReturnFocus && document.body.contains(actionReturnFocus)) {
        actionReturnFocus.focus();
    }
}


function trapFocus(event, dialog) {
    const focusable = Array.from(dialog.querySelectorAll("button, input:not([type='hidden']), select"))
        .filter((element) => !element.disabled && element.offsetParent !== null);

    if (focusable.length === 0) {
        return;
    }

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


function lockReasonFor(action, button) {
    if (action === "delete" && button.dataset.userId === currentUserId) {
        return "You cannot delete your own account.";
    }

    return null;
}


function updateActionLock(button) {
    const action = button.classList.contains("btn-delete") ? "delete" : "edit";
    const verb = action === "delete" ? "Delete" : "Edit";
    const reason = lockReasonFor(action, button);

    button.classList.toggle("is-locked", reason !== null);
    button.title = reason || verb;
    button.setAttribute("aria-label", reason || `${verb} ${button.dataset.username}`);

    if (reason) {
        button.dataset.lockReason = reason;
        button.setAttribute("aria-disabled", "true");
        button.removeAttribute("aria-haspopup");
    } else {
        delete button.dataset.lockReason;
        button.removeAttribute("aria-disabled");
        button.setAttribute("aria-haspopup", "dialog");
    }
}


function refreshAfterChange() {
    if (typeof applyUserFilters === "function") {
        applyUserFilters();
    }

    if (typeof loadHistory === "function") {
        loadHistory();
    }
}


function updateRoleHint() {
    if (editIdInput.value === currentUserId) {
        editRoleHint.textContent = "You cannot change your own role.";
    } else if (editRoleSelect.value !== editOriginalRole) {
        editRoleHint.textContent = editRoleSelect.value === "admin"
            ? "This user will get full admin access."
            : "This user will lose admin access.";
    } else {
        editRoleHint.textContent = "";
    }
}


function openEditModal(button) {
    editOriginalRole = button.dataset.role;

    clearEditErrors();

    editIdInput.value = button.dataset.userId;
    editUsernameInput.value = button.dataset.username;
    editEmailInput.value = button.dataset.email;
    editRoleSelect.value = button.dataset.role;
    editRoleSelect.disabled = button.dataset.userId === currentUserId;
    editTitle.textContent = `Edit ${button.dataset.username}`;

    updateRoleHint();

    openDialog(editModal, button, editUsernameInput);
}


function validateEditForm() {
    const username = editUsernameInput.value.trim();

    if (username === "") {
        setFieldError(editUsernameInput, "Username is required.");
        return false;
    }

    if (!EDIT_USERNAME_PATTERN.test(username)) {
        setFieldError(editUsernameInput, 'Username must be 3-50 characters: letters, numbers, ".", "_" or "-".');
        return false;
    }

    setFieldError(editUsernameInput, "");
    return true;
}


function applyUserToPage(user) {
    const role = user.role;
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

    document.querySelectorAll(`.user-item[data-user-id="${user.id}"]`).forEach((item) => {
        item.dataset.name = user.username.toLowerCase();
        item.dataset.email = user.email.toLowerCase();
        item.dataset.role = role;

        item.querySelector(".user-name").textContent = user.username;
        item.querySelector(".user-email").textContent = user.email;

        const badge = item.querySelector(".role-badge");
        badge.className = `role-badge role-${role}`;
        badge.textContent = roleLabel;
    });

    document.querySelectorAll(`.btn-edit[data-user-id="${user.id}"], .btn-delete[data-user-id="${user.id}"]`)
        .forEach((button) => {
            button.dataset.username = user.username;
            button.dataset.email = user.email;
            button.dataset.role = role;
            updateActionLock(button);
        });

    if (String(user.id) === currentUserId) {
        document.querySelectorAll(".account-greeting, .account-menu-greeting").forEach((element) => {
            element.textContent = `Hello, ${user.username}`;
        });
    }

    refreshAfterChange();
}


async function saveUser() {
    const payload = {
        id: Number(editIdInput.value),
        username: editUsernameInput.value.trim(),
        email: editEmailInput.value.trim(),
        role: editRoleSelect.value,
    };

    editSaveButton.disabled = true;
    editSaveButton.textContent = "Saving...";

    try {
        const response = await fetch("api/admin-users.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            const fields = data.fields || {};

            if (fields.username) setFieldError(editUsernameInput, fields.username);
            if (fields.email) setFieldError(editEmailInput, fields.email);
            if (fields.role) setFieldError(editRoleSelect, fields.role);

            if (response.status === 401) {
                showEditError("Your session has expired. Please sign in again.");
            } else if (Object.keys(fields).length === 0) {
                showEditError(data.error || "Could not save the changes. Please try again.");
            }

            return;
        }

        applyUserToPage(data.user);
        closeDialog(editModal);
        showEditStatus(data.changed ? `Changes to ${data.user.username} were saved.` : "No changes were made.");
    } catch (error) {
        showEditError("Could not reach the server. Check your connection and try again.");
    } finally {
        editSaveButton.disabled = false;
        editSaveButton.textContent = "Save changes";
    }
}


function openDeleteDialog(button) {
    deleteTarget = {
        id: button.dataset.userId,
        username: button.dataset.username,
        email: button.dataset.email,
    };

    deleteTitle.textContent = `Delete ${deleteTarget.username}?`;
    deleteText.textContent = `This permanently deletes the account ${deleteTarget.username} (${deleteTarget.email}). `
        + "Their preferences are deleted too. Their past activity stays in History. "
        + "This cannot be undone.";

    deleteError.hidden = true;
    deleteError.textContent = "";

    openDialog(deleteDialog, button, deleteCancelButton);
}


function focusUserList() {
    const visibleList = [document.getElementById("user-table-scroll"), document.getElementById("user-card-list")]
        .find((list) => list && list.offsetParent !== null);

    if (visibleList) {
        visibleList.focus();
    }
}


async function deleteUser() {
    if (!deleteTarget) {
        return;
    }

    const target = deleteTarget;

    deleteConfirmButton.disabled = true;
    deleteCancelButton.disabled = true;
    deleteConfirmButton.textContent = "Deleting...";

    try {
        const response = await fetch("api/admin-users.php", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: Number(target.id) }),
        });

        const data = await response.json();

        if (!response.ok && response.status !== 404) {
            deleteError.textContent = response.status === 401
                ? "Your session has expired. Please sign in again."
                : (data.error || "Could not delete the user. Please try again.");
            deleteError.hidden = false;
            return;
        }

        if (typeof removeUserFromLists === "function") {
            removeUserFromLists(target.id);
        }

        actionReturnFocus = null;
        closeDialog(deleteDialog);
        deleteTarget = null;
        focusUserList();

        showEditStatus(response.status === 404
            ? `${target.username} had already been deleted.`
            : `${target.username} was deleted.`);

        refreshAfterChange();
    } catch (error) {
        deleteError.textContent = "Could not reach the server. Check your connection and try again.";
        deleteError.hidden = false;
    } finally {
        deleteConfirmButton.disabled = false;
        deleteCancelButton.disabled = false;
        deleteConfirmButton.textContent = "Delete user";
    }
}


document.addEventListener("click", (event) => {
    const button = event.target.closest(".btn-edit, .btn-delete");

    if (!button) {
        return;
    }

    if (button.classList.contains("is-locked")) {
        showEditStatus(button.dataset.lockReason, true);
        return;
    }

    if (button.classList.contains("btn-delete")) {
        openDeleteDialog(button);
    } else {
        openEditModal(button);
    }
});

editForm.addEventListener("submit", (event) => {
    event.preventDefault();

    clearEditErrors();

    if (validateEditForm()) {
        saveUser();
    }
});

editRoleSelect.addEventListener("change", updateRoleHint);
editCancelButton.addEventListener("click", () => closeDialog(editModal));

deleteCancelButton.addEventListener("click", () => closeDialog(deleteDialog));
deleteConfirmButton.addEventListener("click", deleteUser);

editBackdrop.addEventListener("click", () => {
    if (deleteConfirmButton.disabled) {
        return;
    }

    closeDialog(editModal);
    closeDialog(deleteDialog);
});

[editModal, deleteDialog].forEach((dialog) => {
    dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();

            if (!deleteConfirmButton.disabled) {
                closeDialog(dialog);
            }
        } else if (event.key === "Tab") {
            trapFocus(event, dialog);
        }
    });
});
