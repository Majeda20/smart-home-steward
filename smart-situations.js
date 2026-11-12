const API_URL = "api/situations.php";
const API_TIMEOUT_MS = 20000;
const REFRESH_MS = 5000;

const STATUS_LABELS = { active: "New", acknowledged: "Acknowledged", dismissed: "Dismissed", resolved: "Resolved" };
const HANDLED_VERBS = { acknowledged: "Acknowledged", dismissed: "Dismissed", resolved: "Resolved" };
const FILTERS = {
    waiting: (d) => d.status === "active" || d.status === "acknowledged",
    done: (d) => d.status === "resolved",
    dismissed: (d) => d.status === "dismissed",
    all: () => true,
};

class ApiError extends Error {}

async function request(url, options = {}) {
    let response;
    let data;

    try {
        response = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(API_TIMEOUT_MS), ...options });
        data = await response.json();
    } catch (error) {
        throw new ApiError(error.name === "TimeoutError"
            ? "The server is not responding. Please try again later."
            : "Could not reach the server. Please try again.");
    }

    if (!response.ok) {
        const failure = new ApiError(data.error || "Something went wrong. Please try again.");
        failure.status = response.status;
        throw failure;
    }

    return data;
}

const DetectionsApi = {
    list() {
        return request(API_URL);
    },

    change(id, action, actions) {
        return request(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, action, actions }),
        });
    },
};

let detections = [];
let detectionsJson = "";
let activeFilter = "waiting";
let loaded = false;
let busy = false;
const openDetails = new Set();
let modalItem = null;
let modalChoices = [];
let modalReturnFocus = null;
let toastTimer = null;

const list = document.getElementById("ss-list");
const emptyText = document.getElementById("ss-empty");
const searchInput = document.getElementById("ss-search");
const roomSelect = document.getElementById("ss-room");
const tabs = document.getElementById("ss-tabs");
const toast = document.getElementById("ss-toast");

const modal = document.getElementById("ss-modal");
const backdrop = document.getElementById("ss-backdrop");
const modalTitle = document.getElementById("ss-modal-title");
const modalSub = document.getElementById("ss-modal-sub");
const optionList = document.getElementById("ss-options");
const selectAll = document.getElementById("ss-select-all");
const selectedCount = document.getElementById("ss-selected-count");
const runButton = document.getElementById("ss-modal-run");

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    Object.entries(props).forEach(([key, value]) => {
        if (key === "class") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
    });

    children.forEach((child) => node.append(child));
    return node;
}

function normalize(text) {
    return text.toLowerCase().replace(/₂/g, "2");
}

function formatTime(iso) {
    if (!iso) return "";

    const date = new Date(iso);
    const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === new Date().toDateString()) return time;
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

    return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}

function formatValue(action, value) {
    const setting = action.setting;
    if (!setting || setting.options) return String(value);
    return `${value} ${setting.unit}`;
}

function actionTitle(action, value = action.value) {
    return action.type === "set_value" ? `${action.label} to ${formatValue(action, value)}` : action.label;
}

function showToast(text, isError = false) {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.toggle("is-error", isError);
    toast.setAttribute("role", isError ? "alert" : "status");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 8000 : 4000);
}

function updateNavBadge() {
    if (typeof showSituationsBadge === "function" && document.querySelector("[data-situations-badge]")) {
        showSituationsBadge(detections.filter((d) => d.status === "active").length);
    }
}

function updateTabs() {
    tabs.querySelectorAll("button").forEach((button) => {
        const filter = button.dataset.filter;
        button.setAttribute("aria-pressed", filter === activeFilter ? "true" : "false");

        const count = button.querySelector(".ss-tab-count");
        if (count) count.textContent = `(${detections.filter(FILTERS[filter]).length})`;
    });
}

function fillRooms() {
    const selected = roomSelect.value;
    const rooms = [...new Set(detections.map((d) => d.room))].sort();

    roomSelect.replaceChildren(el("option", { value: "", text: "All rooms" }));
    rooms.forEach((room) => roomSelect.append(el("option", { value: room, text: room })));
    roomSelect.value = rooms.includes(selected) ? selected : "";
}

function cell(className, label, content) {
    const node = el("div", { class: className });
    if (label) node.append(el("span", { class: "ss-cell-label", text: label + ":" }));
    node.append(content);
    return node;
}

function button(className, text, onClick) {
    const node = el("button", { type: "button", class: className, text, disabled: busy });
    node.addEventListener("click", () => onClick(node));
    return node;
}

function buttonsFor(item) {
    const buttons = [];
    const canRun = item.ongoing && item.actions.length > 0;

    if (item.status === "active" || item.status === "acknowledged") {
        buttons.push(button("ss-btn ss-btn-grey", "Dismiss", () => changeItem(item, "dismiss")));

        if (item.status === "active") {
            buttons.push(button("ss-btn ss-btn-outline", "Acknowledge", () => changeItem(item, "acknowledge")));
        }

        if (canRun) {
            buttons.push(button("ss-btn ss-btn-red", "Accept", (node) => openModal(item, node)));
        }
    } else if (item.status === "dismissed" && item.ongoing) {
        buttons.push(button("ss-btn ss-btn-outline", "Undo", () => changeItem(item, "restore")));
    }

    return el("div", { class: "ss-buttons" }, buttons);
}

function chipsFor(item) {
    if (item.actions.length === 0) {
        return [el("span", { class: "ss-chip", text: "No actions" })];
    }

    return item.actions.map((action) => {
        const ran = item.userActions.some((r) => r.ok);
        return el("span", { class: "ss-chip" + (ran ? " is-done" : ""), text: actionTitle(action) });
    });
}

function statusLine(item) {
    if (item.ongoing) {
        return `Still happening (last checked ${formatTime(item.checkedAt)}).`;
    }

    return `Ended at ${formatTime(item.endedAt)}: the conditions are no longer true.`;
}

function handledLine(item) {
    const verb = HANDLED_VERBS[item.status];

    if (!verb) return null;

    if (!item.handledBy) {
        return item.status === "resolved"
            ? `Resolved at ${formatTime(item.handledAt)} because the conditions are no longer true.`
            : `${verb} at ${formatTime(item.handledAt)}.`;
    }

    return `${verb} by ${item.handledBy} at ${formatTime(item.handledAt)}.`;
}

function renderItem(item) {
    const isOpen = openDetails.has(item.id);
    const wrapper = el("article", { class: "ss-item" + (isOpen ? " is-open" : ""), "aria-label": `${item.name}, ${item.room}` });
    const detailsId = `ss-details-${item.id}`;

    const toggle = el("button", {
        type: "button", class: "ss-details-toggle", text: isOpen ? "Hide details" : "Details",
        "aria-expanded": isOpen ? "true" : "false", "aria-controls": detailsId,
    });

    toggle.addEventListener("click", () => {
        if (openDetails.has(item.id)) openDetails.delete(item.id);
        else openDetails.add(item.id);
        render();
        list.querySelector(`[aria-controls="${detailsId}"]`).focus();
    });

    const name = el("div", { class: "ss-name", text: item.name });

    if (!item.complete) {
        name.append(el("span", { class: "ss-uncertain", text: "Uncertain" }));
    }

    const row = el("div", { class: "ss-row" }, [
        cell("ss-cell-situation", null, el("div", {}, [name, toggle])),
        cell("ss-cell-meta", "Room", document.createTextNode(item.room)),
        cell("ss-cell-meta", "Detected", document.createTextNode(formatTime(item.detectedAt))),
        cell("ss-cell-actions", null, el("div", { class: "ss-chips" }, chipsFor(item))),
        el("span", { class: `ss-badge ss-badge-${item.status}`, text: STATUS_LABELS[item.status] }),
        buttonsFor(item),
    ]);

    const why = el("ul", { class: "ss-why" }, item.observations.map((o) => el("li", { text: o.text })));
    const details = el("div", { class: "ss-details", id: detailsId, hidden: !isOpen }, [
        el("div", {}, [el("strong", { text: "Why it was detected:" }), why]),
    ]);

    if (!item.complete) {
        details.append(el("p", {
            class: "ss-warning",
            text: "Some sensors did not report data, so this detection may not be accurate. Check the room before acting.",
        }));
    }

    details.append(el("div", {}, [el("strong", { text: "Now: " }), statusLine(item)]));

    const handled = handledLine(item);
    if (handled) details.append(el("div", {}, [el("strong", { text: "Handled: " }), handled]));

    if (item.userActions.length) {
        details.append(el("div", {}, [
            el("strong", { text: "Actions run: " }),
            item.userActions.map((r) => r.text).join(", "),
        ]));
    }

    if (item.actions.length && (item.status === "active" || item.status === "acknowledged")) {
        const steps = item.actions.map((a, i) => `${i + 1}. ${actionTitle(a)}`).join("  ");
        details.append(el("div", {}, [el("strong", { text: "On accept: " }), steps]));
    }

    wrapper.append(row, details);
    return wrapper;
}

function render() {
    const query = normalize(searchInput.value.trim());
    const room = roomSelect.value;

    const shown = detections.filter((d) => FILTERS[activeFilter](d)
        && (room === "" || d.room === room)
        && (query === "" || normalize(`${d.name} ${d.room}`).includes(query)));

    list.replaceChildren(...shown.map(renderItem));

    emptyText.hidden = !loaded || shown.length > 0;
    emptyText.textContent = activeFilter === "waiting" && query === "" && room === ""
        ? "There are no open situations right now."
        : "No situations match your filters.";

    updateTabs();
    updateNavBadge();
}

async function load({ quiet = false } = {}) {
    try {
        const data = await DetectionsApi.list();
        const json = JSON.stringify(data.situations.map(({ checkedAt, ...rest }) => rest));

        if (loaded && json === detectionsJson) {
            return;
        }

        detections = data.situations;
        detectionsJson = json;
        loaded = true;
        fillRooms();
        render();

        if (!data.homeAssistant && !quiet) {
            showToast("Home Assistant is not reachable, so device names in the actions may be missing.", true);
        }
    } catch (error) {
        if (!quiet || !loaded) {
            if (!loaded) {
                emptyText.hidden = false;
                emptyText.textContent = "Could not load situations.";
            }
            showToast(error.message, true);
        }
    }
}

async function changeItem(item, action, actions) {
    if (busy) return false;

    busy = true;
    render();

    try {
        const result = await DetectionsApi.change(item.id, action, actions);
        const messages = {
            acknowledge: `"${item.name}" in ${item.room} was acknowledged.`,
            dismiss: `"${item.name}" in ${item.room} was dismissed.`,
            restore: `"${item.name}" in ${item.room} is open again.`,
            run: `${result.message} "${item.name}" in ${item.room} is resolved. If the problem is still there in 2 minutes, it will show up again.`,
        };
        showToast(messages[action]);
        return true;
    } catch (error) {
        showToast(error.message, true);
        return false;
    } finally {
        busy = false;
        render();
        await load({ quiet: true });
    }
}

function updateModalFooter() {
    const count = modalChoices.filter((c) => c.selected).length;
    selectedCount.textContent = `${count} of ${modalChoices.length} actions selected`;
    runButton.textContent = count === 1 ? "Run 1 action" : `Run ${count} actions`;
    runButton.disabled = count === 0 || busy;
    selectAll.checked = count === modalChoices.length;
    selectAll.indeterminate = count > 0 && count < modalChoices.length;
}

function valueControl(choice) {
    const setting = choice.setting;

    if (setting.options) {
        const select = el("select", { class: "ss-option-select", "aria-label": `${choice.label} value` });
        setting.options.forEach((option) => select.append(el("option", { value: option, text: option, selected: option === choice.value })));
        select.addEventListener("change", () => { choice.value = select.value; });
        return select;
    }

    const output = el("output", { "aria-live": "polite" });
    const minus = el("button", { type: "button", text: "-", "aria-label": `Lower ${choice.label}` });
    const plus = el("button", { type: "button", text: "+", "aria-label": `Raise ${choice.label}` });
    const step = setting.step < 1 ? setting.step : 5 * setting.step;

    const sync = () => {
        output.textContent = formatValue(choice, choice.value);
        minus.disabled = choice.value <= setting.min;
        plus.disabled = choice.value >= setting.max;
    };

    const change = (delta) => {
        choice.value = Math.min(setting.max, Math.max(setting.min, Math.round((choice.value + delta) * 10) / 10));
        sync();
    };

    minus.addEventListener("click", () => change(-step));
    plus.addEventListener("click", () => change(step));
    sync();

    return el("div", { class: "ss-stepper" }, [minus, output, plus]);
}

function renderOptions() {
    optionList.innerHTML = "";

    modalChoices.forEach((choice) => {
        const checkbox = el("input", { type: "checkbox", checked: choice.selected, id: `ss-opt-${choice.index}` });
        const option = el("li", { class: "ss-option" + (choice.selected ? " is-checked" : "") });

        checkbox.addEventListener("change", () => {
            choice.selected = checkbox.checked;
            option.classList.toggle("is-checked", checkbox.checked);
            updateModalFooter();
        });

        const devices = choice.devices.length
            ? `${modalItem.room}: ${choice.devices.join(", ")}`
            : `No matching devices found in ${modalItem.room}`;

        const main = el("label", { class: "ss-option-main", for: `ss-opt-${choice.index}` }, [
            checkbox,
            el("span", {}, [
                el("span", { class: "ss-option-title", text: choice.label }),
                el("span", { class: "ss-option-desc", text: devices }),
            ]),
        ]);

        option.append(main);

        if (choice.type === "set_value" && choice.setting) {
            option.append(valueControl(choice));
        }

        optionList.append(option);
    });

    updateModalFooter();
}

function openModal(item, trigger) {
    modalItem = item;
    modalReturnFocus = trigger;
    modalChoices = item.actions.map((a) => ({ ...a, selected: a.devices.length > 0 }));

    modalTitle.textContent = `Accept: ${item.name}`;
    modalSub.textContent = `${item.room} · detected ${formatTime(item.detectedAt)} · choose what should happen`;
    renderOptions();

    modal.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add("modal-open");
    optionList.querySelector("input").focus();
}

function closeModal() {
    modal.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("modal-open");
    modalItem = null;
    if (modalReturnFocus && document.body.contains(modalReturnFocus)) modalReturnFocus.focus();
    else searchInput.focus();
}

selectAll.addEventListener("change", () => {
    modalChoices.forEach((c) => { c.selected = selectAll.checked; });
    renderOptions();
});

runButton.addEventListener("click", async () => {
    const chosen = modalChoices
        .filter((c) => c.selected)
        .map((c) => (c.type === "set_value" ? { index: c.index, value: c.value } : { index: c.index }));
    const item = modalItem;

    runButton.disabled = true;
    runButton.textContent = "Running...";

    const ok = await changeItem(item, "run", chosen);

    if (ok) {
        modalReturnFocus = null;
        closeModal();
    } else {
        updateModalFooter();
    }
});

document.getElementById("ss-modal-cancel").addEventListener("click", closeModal);
document.getElementById("ss-modal-close").addEventListener("click", closeModal);
backdrop.addEventListener("click", closeModal);

document.addEventListener("keydown", (event) => {
    if (modal.hidden) return;

    if (event.key === "Escape") {
        closeModal();
        return;
    }

    if (event.key === "Tab") {
        const focusable = [...modal.querySelectorAll("button:not(:disabled), input, select")];
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
});

tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("button");
    if (!tab) return;
    activeFilter = tab.dataset.filter;
    render();
});

searchInput.addEventListener("input", render);
roomSelect.addEventListener("change", render);

function refreshQuietly() {
    if (!document.hidden && modal.hidden && !busy) load({ quiet: true });
}

setInterval(refreshQuietly, REFRESH_MS);
document.addEventListener("visibilitychange", refreshQuietly);

emptyText.hidden = false;
emptyText.textContent = "Loading situations...";
load();
