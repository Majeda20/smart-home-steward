const OPERATORS = {
    state:  [{ value: "is", label: "is" }, { value: "is_not", label: "is not" }],
    number: [{ value: "above", label: "is above" }, { value: "below", label: "is below" }, { value: "equals", label: "equals" }],
    time:   [{ value: "between", label: "is between" }],
};

const ACTION_TYPES = [
    { value: "turn_on",   label: "Turn on device" },
    { value: "turn_off",  label: "Turn off device" },
    { value: "set_value", label: "Set value" },
];

const API_URL = "api/admin-situations.php";
const API_TIMEOUT_MS = 15000;

class ApiError extends Error {
    constructor(message, fields = {}) {
        super(message);
        this.fields = fields;
    }
}

async function request(method, body) {
    let response;
    let data;

    try {
        response = await fetch(API_URL, {
            method,
            credentials: "same-origin",
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
            ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        });
        data = await response.json();
    } catch (error) {
        throw new ApiError(error.name === "TimeoutError"
            ? "The server is not responding. Please try again later."
            : "Could not reach the server. Please try again.");
    }

    if (!response.ok) {
        throw new ApiError(data.error || "Something went wrong. Please try again.", data.fields || {});
    }

    return data;
}

const SituationsApi = {
    load() {
        return request("GET");
    },

    async create(situation) {
        return (await request("POST", situation)).rule;
    },

    async update(id, situation) {
        return (await request("POST", { ...situation, id })).rule;
    },

    async setEnabled(id, enabled) {
        return (await request("PATCH", { id, enabled })).rule;
    },

    remove(id) {
        return request("DELETE", { id });
    },
};

let ENTITIES = {};
let rooms = [];
let situations = [];
let editingId = null;
let pendingDeleteId = null;
let statusTimer = null;

const form = document.getElementById("situation-form");
const formTitle = document.getElementById("situation-form-title");
const nameInput = document.getElementById("situation-name");
const submitButton = document.getElementById("situation-submit");
const clearButton = document.getElementById("situation-clear");
const roomGrid = document.getElementById("room-grid");
const roomCount = document.getElementById("room-count");
const conditionList = document.getElementById("condition-list");
const actionList = document.getElementById("action-list");
const statusMessage = document.getElementById("situation-status");

const searchInput = document.getElementById("situation-search");
const stateFilter = document.getElementById("situation-state-filter");
const resultsText = document.getElementById("situation-results");
const enabledCount = document.getElementById("enabled-count");
const situationGrid = document.getElementById("situation-grid");

const deleteModal = document.getElementById("situation-delete");
const deleteBackdrop = document.getElementById("situation-delete-backdrop");
const deleteText = document.getElementById("situation-delete-text");
const deleteConfirm = document.getElementById("situation-delete-confirm");
const deleteCancel = document.getElementById("situation-delete-cancel");

function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);

    Object.entries(props).forEach(([key, value]) => {
        if (key === "class") {
            node.className = value;
        } else if (key === "text") {
            node.textContent = value;
        } else if (key in node) {
            node[key] = value;
        } else {
            node.setAttribute(key, value);
        }
    });

    children.forEach((child) => node.append(child));
    return node;
}

function makeSelect(options, selected, props = {}, placeholder = null) {
    const select = el("select", props);

    if (placeholder) {
        select.append(el("option", { value: "", text: placeholder, selected: !selected }));
    }

    options.forEach((option) => {
        select.append(el("option", { value: option.value, text: option.label, selected: option.value === selected }));
    });

    return select;
}

function removeButton(label) {
    return el("button", { type: "button", class: "cs-remove", "aria-label": label, title: "Remove" }, [
        el("img", { src: "../images/icons/close.svg", alt: "" }),
    ]);
}

function showStatus(text, isError = false) {
    statusMessage.textContent = text;
    statusMessage.hidden = false;
    statusMessage.classList.toggle("admin-message-success", !isError);
    statusMessage.classList.toggle("admin-message-error", isError);
    statusMessage.setAttribute("role", isError ? "alert" : "status");
    clearTimeout(statusTimer);

    if (!isError) {
        statusTimer = setTimeout(() => { statusMessage.hidden = true; }, 4000);
    }
}

function roomName(id) {
    const room = rooms.find((r) => r.id === id);
    return room ? room.name : "";
}

function entityOptions(filter) {
    return Object.entries(ENTITIES)
        .filter(([, entity]) => filter(entity))
        .map(([key, entity]) => ({ value: key, label: entity.label }));
}

function requiredEntities() {
    const keys = new Set();

    readConditions().forEach((c) => {
        if (ENTITIES[c.entity] && !ENTITIES[c.entity].global) keys.add(c.entity);
    });

    readActions().forEach((a) => {
        if (ENTITIES[a.target]) keys.add(a.target);
    });

    return [...keys];
}

function renderRooms(selectedIds) {
    const required = requiredEntities();
    roomGrid.innerHTML = "";

    rooms.forEach((room) => {
        const missing = required.filter((key) => !room.entities.includes(key));
        const disabled = missing.length > 0;
        const checked = !disabled && selectedIds.includes(room.id);

        const input = el("input", { type: "checkbox", value: room.id, checked, disabled });
        const label = el("span", {}, [room.name]);

        if (disabled) {
            label.append(el("span", {
                class: "cs-room-missing",
                text: "No " + missing.map((k) => ENTITIES[k].label.replace(/ \(.*\)$/, "").toLowerCase()).join(", "),
            }));
        }

        const card = el("label", {
            class: "cs-room" + (checked ? " is-checked" : "") + (disabled ? " is-disabled" : ""),
        }, [input, label]);

        input.addEventListener("change", () => {
            card.classList.toggle("is-checked", input.checked);
            updateRoomCount();
            updateEntityOptions();
        });

        roomGrid.append(card);
    });

    updateRoomCount();
    updateEntityOptions();
    updateDeviceSelects();
}

function updateDeviceSelects() {
    const selected = selectedRoomIds();
    const room = selected.length === 1 ? rooms.find((r) => r.id === selected[0]) : null;

    actionList.querySelectorAll(".cs-action-row").forEach((row) => {
        const select = row.querySelector(".cs-device");
        if (!select) return;

        const target = row.querySelector(".cs-target").value;
        const devices = room && target ? (room.devices[target] || []) : [];
        const wanted = row.dataset.entity || "";

        select.replaceChildren(
            el("option", { value: "", text: "All in the room" }),
            ...devices.map((device) => el("option", { value: device.id, text: device.name })),
        );

        select.value = devices.some((device) => device.id === wanted) ? wanted : "";
        select.hidden = devices.length < 2;
    });
}

function roomsMissing(key) {
    if (!ENTITIES[key] || ENTITIES[key].global) return [];

    const selected = selectedRoomIds();
    return rooms.filter((room) => selected.includes(room.id) && !room.entities.includes(key));
}

function updateEntityOptions() {
    const filtering = selectedRoomIds().length > 0;

    form.querySelectorAll("select.cs-entity, select.cs-target").forEach((select) => {
        [...select.options].forEach((option) => {
            if (option.value === "") return;

            if (!option.dataset.label) option.dataset.label = option.textContent;

            const missing = roomsMissing(option.value);
            option.disabled = missing.length > 0 && option.value !== select.value;
            option.classList.toggle("is-available", filtering && missing.length === 0);
            option.classList.toggle("is-missing", missing.length > 0);
            option.textContent = missing.length
                ? `${option.dataset.label} - not in ${missing.map((room) => room.name).join(", ")}`
                : option.dataset.label;
        });
    });
}

function selectedRoomIds() {
    return [...roomGrid.querySelectorAll("input:checked")].map((input) => input.value);
}

function updateRoomCount() {
    roomCount.textContent = `- ${selectedRoomIds().length} of ${rooms.length} selected`;
}

function refreshRooms() {
    renderRooms(selectedRoomIds());
}

function buildValueControl(entityKey, value) {
    const entity = ENTITIES[entityKey];

    if (entity.kind === "state") {
        const options = entity.states.map((s) => ({ value: s, label: s }));
        return makeSelect(options, value ?? entity.states[0], { class: "cs-mid cs-value", "aria-label": "Value" });
    }

    if (entity.kind === "time") {
        const from = el("input", { type: "time", class: "cs-time-from", value: value?.from ?? "22:00", "aria-label": "From" });
        const to = el("input", { type: "time", class: "cs-time-to", value: value?.to ?? "06:00", "aria-label": "To" });
        const range = el("span", { class: "cs-value cs-time-range" }, [from, "and", to]);
        range.style.display = "contents";
        return range;
    }

    return el("input", {
        type: "number", class: "cs-num cs-value", value: value ?? "", placeholder: "Value", "aria-label": `Value in ${entity.unit}`,
    });
}

function addConditionRow(condition = {}) {
    const entityKey = condition.entity || "";
    const row = el("li", { class: "cs-row cs-condition-row" });

    const entitySelect = makeSelect(
        entityOptions(() => true), entityKey,
        { class: "cs-grow cs-entity", "aria-label": "Sensor or device" },
        "Choose a sensor or device"
    );
    let operatorSelect;
    let valueControl;
    let unit;

    const durationInput = el("input", {
        type: "number", min: 0, max: 1440, step: 1, value: condition.duration ?? 0, placeholder: "0", "aria-label": "Minimum duration in minutes, 0 means instantly",
    });
    durationInput.classList.add("cs-duration-input");
    const duration = el("label", { class: "cs-duration" }, ["for at least", durationInput, "min"]);

    function buildDependent(operator, value) {
        const entity = ENTITIES[entitySelect.value];

        const newOperator = entity
            ? makeSelect(OPERATORS[entity.kind], operator ?? OPERATORS[entity.kind][0].value, { class: "cs-mid cs-operator", "aria-label": "Comparison" })
            : el("span", { class: "cs-operator" });
        const newValue = entity ? buildValueControl(entitySelect.value, value) : el("span", { class: "cs-value" });
        const newUnit = el("span", { class: "cs-unit", text: entity && entity.kind === "number" ? entity.unit : "" });

        if (operatorSelect) {
            operatorSelect.replaceWith(newOperator);
            valueControl.replaceWith(newValue);
            unit.replaceWith(newUnit);
        }

        operatorSelect = newOperator;
        valueControl = newValue;
        unit = newUnit;
        unit.hidden = !entity || entity.kind !== "number";
        duration.hidden = !entity || entity.kind === "time";

        if (entity && entity.kind === "time") durationInput.value = 0;
    }

    buildDependent(condition.operator, condition.value);

    entitySelect.addEventListener("change", () => {
        buildDependent();
        refreshRooms();
    });

    const remove = removeButton("Remove condition");
    remove.addEventListener("click", () => {
        row.remove();
        updateRemoveButtons();
        refreshRooms();
    });

    row.append(entitySelect, operatorSelect, valueControl, unit, duration, remove);
    conditionList.append(row);
    updateRemoveButtons();
}

function readConditions() {
    return [...conditionList.querySelectorAll(".cs-condition-row")].map((row) => {
        const entity = row.querySelector(".cs-entity").value;

        if (!ENTITIES[entity]) {
            return { entity: "", operator: "", value: null, duration: null };
        }

        const kind = ENTITIES[entity].kind;
        const valueNode = row.querySelector(".cs-value");
        const durationValue = row.querySelector(".cs-duration-input").value;
        let value = valueNode.value;

        if (kind === "number") {
            value = valueNode.value === "" ? null : Number(valueNode.value);
        } else if (kind === "time") {
            value = { from: row.querySelector(".cs-time-from").value, to: row.querySelector(".cs-time-to").value };
        }

        return {
            entity,
            operator: row.querySelector(".cs-operator").value,
            value,
            duration: kind === "time" || durationValue === "" || Number(durationValue) === 0 ? null : Number(durationValue),
        };
    });
}

function actionTargets(type) {
    if (type === "set_value") return entityOptions((e) => Boolean(e.settable));
    return entityOptions((e) => e.device);
}

function addActionRow(action = {}) {
    const row = el("li", { class: "cs-row cs-action-row" });
    row.dataset.entity = action.entity || "";
    const step = el("span", { class: "cs-step", "aria-hidden": "true" });
    const typeSelect = makeSelect(
        ACTION_TYPES, action.type || "",
        { class: "cs-mid cs-action-type", "aria-label": "Action" },
        "Choose an action"
    );
    const fields = el("span", { class: "cs-action-fields" });
    fields.style.display = "contents";

    function buildFields(values = {}) {
        fields.innerHTML = "";
        const type = typeSelect.value;

        const targets = type ? actionTargets(type) : [];
        const target = targets.some((t) => t.value === values.target) ? values.target : "";
        const targetSelect = makeSelect(
            targets, target,
            { class: "cs-grow cs-target", "aria-label": "Device", disabled: !type },
            "Choose a device"
        );
        fields.append(targetSelect);

        const deviceSelect = el("select", { class: "cs-mid cs-device", "aria-label": "Which device", hidden: true });
        deviceSelect.addEventListener("change", () => { row.dataset.entity = deviceSelect.value; });
        fields.append(deviceSelect);

        if (type === "set_value") {
            const valueSlot = el("span", { class: "cs-set-slot" });
            valueSlot.style.display = "contents";
            let initial = values.value;

            const syncValue = () => {
                valueSlot.innerHTML = "";

                if (!ENTITIES[targetSelect.value]) return;

                const settable = ENTITIES[targetSelect.value].settable;

                if (settable.options) {
                    const options = settable.options.map((o) => ({ value: o, label: o }));
                    const selected = settable.options.includes(initial) ? initial : settable.options[0];
                    valueSlot.append(makeSelect(options, selected, { class: "cs-mid cs-set-value", "aria-label": settable.name }));
                } else {
                    const input = el("input", {
                        type: "number", class: "cs-num cs-set-value", value: typeof initial === "number" ? initial : "",
                        placeholder: "Value", min: settable.min, max: settable.max, step: settable.step,
                        "aria-label": `${settable.name} in ${settable.unit}`,
                    });
                    valueSlot.append(input, el("span", { class: "cs-unit", text: settable.unit }));
                }

                initial = undefined;
            };

            targetSelect.addEventListener("change", syncValue);
            syncValue();
            fields.append(valueSlot);
        }

        targetSelect.addEventListener("change", () => {
            row.dataset.entity = "";
            refreshRooms();
        });
    }

    buildFields(action);

    typeSelect.addEventListener("change", () => {
        row.dataset.entity = "";
        buildFields();
        refreshRooms();
    });

    const remove = removeButton("Remove action");
    remove.addEventListener("click", () => {
        row.remove();
        updateRemoveButtons();
        refreshRooms();
    });

    row.append(step, typeSelect, fields, remove);
    actionList.append(row);
    updateRemoveButtons();
}

function readActions() {
    return [...actionList.querySelectorAll(".cs-action-row")].map((row) => {
        const type = row.querySelector(".cs-action-type").value;
        const action = { type, target: row.querySelector(".cs-target").value };
        const device = row.querySelector(".cs-device");

        if (device && !device.hidden && device.value) {
            action.entity = device.value;
        }

        if (type === "set_value" && ENTITIES[action.target]) {
            const value = row.querySelector(".cs-set-value").value;

            if (ENTITIES[action.target].settable.options) {
                action.value = value;
            } else {
                action.value = value === "" ? null : Number(value);
            }
        }

        return action;
    });
}

function updateRemoveButtons() {
    const conditionRows = conditionList.querySelectorAll(".cs-row");
    const actionRows = actionList.querySelectorAll(".cs-row");

    conditionRows.forEach((row) => { row.querySelector(".cs-remove").disabled = conditionRows.length === 1; });
    actionRows.forEach((row, index) => {
        row.querySelector(".cs-step").textContent = index + 1;
    });

    document.getElementById("actions-none").hidden = actionRows.length > 0;
}

function setError(id, text) {
    document.getElementById(id).textContent = text || "";
}

function validate(data) {
    let valid = true;
    form.querySelectorAll(".input-error").forEach((node) => node.classList.remove("input-error"));
    ["situation-name-error", "rooms-error", "conditions-error", "actions-error"].forEach((id) => setError(id, ""));

    const sameName = situations.some((s) => s.id !== editingId && s.name.toLowerCase() === data.name.toLowerCase());

    if (data.name === "") {
        setError("situation-name-error", "Please enter a name.");
        nameInput.classList.add("input-error");
        valid = false;
    } else if (sameName) {
        setError("situation-name-error", "A situation with this name already exists.");
        nameInput.classList.add("input-error");
        valid = false;
    }

    if (data.rooms.length === 0) {
        setError("rooms-error", "Select at least one room.");
        valid = false;
    }

    conditionList.querySelectorAll(".cs-condition-row").forEach((row, i) => {
        const c = data.conditions[i];
        if (!ENTITIES[c.entity]) {
            row.querySelector(".cs-entity").classList.add("input-error");
            setError("conditions-error", "Choose a sensor or device for every condition.");
            valid = false;
            return;
        }
        if (ENTITIES[c.entity].kind === "number" && c.value === null) {
            row.querySelector(".cs-value").classList.add("input-error");
            setError("conditions-error", "Enter a value for every numeric condition.");
            valid = false;
        }
        if (ENTITIES[c.entity].kind === "time" && (!c.value.from || !c.value.to || c.value.from === c.value.to)) {
            row.querySelectorAll(".cs-time-range input").forEach((input) => input.classList.add("input-error"));
            setError("conditions-error", "Enter two different times for every time condition.");
            valid = false;
        }
        if (c.duration !== null && (c.duration < 1 || !Number.isInteger(c.duration))) {
            row.querySelector(".cs-duration-input").classList.add("input-error");
            setError("conditions-error", "Duration must be a whole number of minutes.");
            valid = false;
        }
    });

    const actionRows = readActions();

    actionList.querySelectorAll(".cs-action-row").forEach((row, i) => {
        const a = actionRows[i];
        if (!a.type) return;
        if (!ENTITIES[a.target]) {
            row.querySelector(".cs-target").classList.add("input-error");
            setError("actions-error", "Choose a device for every action.");
            valid = false;
            return;
        }
        if (a.type === "set_value" && !ENTITIES[a.target].settable.options) {
            const settable = ENTITIES[a.target].settable;
            if (a.value === null || a.value < settable.min || a.value > settable.max) {
                row.querySelector(".cs-set-value").classList.add("input-error");
                setError("actions-error", `${ENTITIES[a.target].label} value must be between ${settable.min} and ${settable.max} ${settable.unit}.`);
                valid = false;
            }
        }
    });

    if (!valid) focusFirstError();

    return valid;
}

function focusFirstError() {
    const firstError = form.querySelector(".input-error") || form.querySelector(".field-error:not(:empty)");
    if (firstError) firstError.scrollIntoView({ block: "center", behavior: "smooth" });
    if (firstError && firstError.focus) firstError.focus({ preventScroll: true });
}

function showServerErrors(error) {
    const fields = {
        name: "situation-name-error",
        rooms: "rooms-error",
        conditions: "conditions-error",
        actions: "actions-error",
    };

    const known = Object.keys(error.fields).filter((key) => fields[key]);

    if (known.length === 0) {
        showStatus(error.message, true);
        return;
    }

    known.forEach((key) => setError(fields[key], error.fields[key]));

    if (error.fields.name) nameInput.classList.add("input-error");

    focusFirstError();
}

function readForm() {
    return {
        name: nameInput.value.trim(),
        rooms: selectedRoomIds(),
        conditions: readConditions(),
        actions: readActions().filter((a) => a.type),
    };
}

function fillForm(situation) {
    nameInput.value = situation ? situation.name : "";

    conditionList.innerHTML = "";
    actionList.innerHTML = "";

    (situation ? situation.conditions : [{}]).forEach(addConditionRow);
    (situation ? situation.actions : [{}]).forEach(addActionRow);

    renderRooms(situation ? situation.rooms : []);

    form.querySelectorAll(".input-error").forEach((node) => node.classList.remove("input-error"));
    form.querySelectorAll(".field-error").forEach((node) => { node.textContent = ""; });
}

function setEditing(id) {
    editingId = id;
    const editing = id !== null;

    formTitle.textContent = editing ? "Edit smart situation" : "Create smart situation";
    submitButton.textContent = editing ? "Save changes" : "Create";
    clearButton.textContent = editing ? "Cancel" : "Clear";

    fillForm(editing ? situations.find((s) => s.id === id) : null);
    renderSituations();
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = readForm();

    if (!validate(data)) return;

    submitButton.disabled = true;

    try {
        if (editingId !== null) {
            const updated = await SituationsApi.update(editingId, data);
            situations = situations.map((s) => (s.id === updated.id ? updated : s));
            showStatus(`"${updated.name}" was updated.`);
        } else {
            const created = await SituationsApi.create(data);
            situations.push(created);
            showStatus(`"${created.name}" was created.`);
        }
        setEditing(null);
    } catch (error) {
        showServerErrors(error);
    } finally {
        submitButton.disabled = false;
    }
});

clearButton.addEventListener("click", () => setEditing(null));

document.getElementById("add-condition").addEventListener("click", () => {
    addConditionRow({});
    refreshRooms();
    conditionList.lastElementChild.querySelector("select").focus();
});

document.getElementById("add-action").addEventListener("click", () => {
    addActionRow({});
    refreshRooms();
    actionList.lastElementChild.querySelector("select").focus();
});

document.getElementById("rooms-select-all").addEventListener("click", () => {
    renderRooms(rooms.map((r) => r.id));
});

document.getElementById("rooms-clear").addEventListener("click", () => {
    renderRooms([]);
});

function describeCondition(c) {
    const entity = ENTITIES[c.entity];
    const label = entity.label.replace(/ \(.*\)$/, "");
    const name = label === "CO₂" ? label : label.toLowerCase();
    let text;

    if (entity.kind === "time") {
        return `time between ${c.value.from} and ${c.value.to}`;
    }

    if (entity.kind === "number") {
        const op = { above: "above", below: "below", equals: "=" }[c.operator];
        text = `${name} ${op} ${c.value} ${entity.unit}`;
    } else {
        text = `${name} ${c.operator === "is_not" ? "not " : ""}${c.value}`;
    }

    if (c.duration) text += ` for ${c.duration} min`;
    return text;
}

function deviceName(entityId) {
    for (const room of rooms) {
        for (const devices of Object.values(room.devices || {})) {
            const device = devices.find((d) => d.id === entityId);
            if (device) return device.name;
        }
    }

    return entityId;
}

function describeAction(a) {
    const target = ENTITIES[a.target];
    const label = a.entity ? deviceName(a.entity) : target.label.replace(/ \(.*\)$/, "").toLowerCase();
    if (a.type === "turn_on") return `turn on ${label}`;
    if (a.type === "turn_off") return `turn off ${label}`;
    if (target.settable.options) return `set ${label} to ${a.value}`;
    return `set ${label} ${a.value} ${target.settable.unit}`;
}

function lastTriggeredLabel(situation) {
    if (!situation.lastTriggered) return "Never triggered";

    const date = new Date(situation.lastTriggered);
    const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const day = date.toDateString() === new Date().toDateString()
        ? "today"
        : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    return `Last triggered ${day} ${time}`;
}

function summary(situation) {
    const conditions = situation.conditions.map(describeCondition).join(" + ");

    const actions = situation.actions.length
        ? situation.actions.map(describeAction).join(", ")
        : "no actions, acknowledge or dismiss only";
    const text = `${conditions} → ${actions}`;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function roomsLabel(situation) {
    if (situation.rooms.length === rooms.length) return "All rooms";
    if (situation.rooms.length === 1) return roomName(situation.rooms[0]);
    return `${situation.rooms.length} rooms`;
}

function searchText(situation) {
    const entityLabels = [
        ...situation.conditions.map((c) => ENTITIES[c.entity].label),
        ...situation.actions.filter((a) => a.target).map((a) => ENTITIES[a.target].label),
    ];

    return [situation.name, summary(situation), ...situation.rooms.map(roomName), ...entityLabels]
        .join(" ")
        .toLowerCase()
        .replace(/₂/g, "2");
}

function situationCard(situation) {
    const toggle = el("input", {
        type: "checkbox", role: "switch", checked: situation.enabled,
        "aria-label": `${situation.enabled ? "Disable" : "Enable"} ${situation.name}`,
    });

    toggle.addEventListener("change", async () => {
        toggle.disabled = true;

        try {
            const updated = await SituationsApi.setEnabled(situation.id, toggle.checked);
            situations = situations.map((s) => (s.id === updated.id ? updated : s));
            showStatus(`"${updated.name}" is now ${updated.enabled ? "on" : "off"}.`);
            renderSituations();
        } catch (error) {
            toggle.checked = !toggle.checked;
            toggle.disabled = false;
            showStatus(error.message, true);
        }
    });

    const editButton = el("button", { type: "button", class: "btn-edit", "aria-label": `Edit ${situation.name}`, title: "Edit" }, [
        el("img", { src: "../images/icons/edit.svg", alt: "" }),
    ]);

    editButton.addEventListener("click", () => {
        setEditing(situation.id);
        document.querySelector(".cs-form-card").scrollIntoView({ behavior: "smooth", block: "start" });
        nameInput.focus({ preventScroll: true });
    });

    const deleteButton = el("button", { type: "button", class: "btn-delete", "aria-label": `Delete ${situation.name}`, title: "Delete" }, [
        el("img", { src: "../images/icons/delete.svg", alt: "" }),
    ]);

    deleteButton.addEventListener("click", () => openDelete(situation, deleteButton));

    const classes = ["cs-sit-card"];
    if (!situation.enabled) classes.push("is-off");
    if (situation.id === editingId) classes.push("is-editing");

    return el("article", { class: classes.join(" "), "data-id": situation.id }, [
        el("div", { class: "cs-sit-top" }, [
            el("h3", { class: "cs-sit-name", text: situation.name }),
            el("span", { class: "cs-switch" }, [toggle, el("span", { class: "cs-switch-track", "aria-hidden": "true" })]),
        ]),
        el("p", { class: "cs-sit-summary", text: summary(situation) }),
        el("div", { class: "cs-sit-foot" }, [
            el("span", { class: "cs-sit-state", text: `${situation.enabled ? "On" : "Off"} · ${roomsLabel(situation)} · ${lastTriggeredLabel(situation)}` }),
            el("span", { class: "user-actions" }, [editButton, deleteButton]),
        ]),
    ]);
}

function renderSituations() {
    const query = searchInput.value.trim().toLowerCase().replace(/₂/g, "2");
    const state = stateFilter.value;

    const matches = situations.filter((s) => {
        const matchesQuery = query === "" || searchText(s).includes(query);
        const matchesState = state === "" || (state === "on") === s.enabled;
        return matchesQuery && matchesState;
    });

    situationGrid.innerHTML = "";
    matches.forEach((s) => situationGrid.append(situationCard(s)));

    if (situations.length === 0) {
        situationGrid.append(el("p", { class: "cs-empty", text: "No smart situations yet. Create one above." }));
    } else if (matches.length === 0) {
        situationGrid.append(el("p", { class: "cs-empty", text: "No situations match your search." }));
    }

    const enabled = situations.filter((s) => s.enabled).length;
    enabledCount.textContent = `${enabled} of ${situations.length} enabled`;
    resultsText.textContent = query || state
        ? `Showing ${matches.length} of ${situations.length} situations`
        : "";
}

searchInput.addEventListener("input", renderSituations);
stateFilter.addEventListener("change", renderSituations);

let deleteReturnFocus = null;

function openDelete(situation, trigger) {
    pendingDeleteId = situation.id;
    deleteReturnFocus = trigger;
    deleteText.textContent = `"${situation.name}" will be permanently deleted. Users will no longer see this situation.`;
    deleteModal.hidden = false;
    deleteBackdrop.hidden = false;
    document.body.classList.add("modal-open");
    deleteCancel.focus();
}

function closeDelete() {
    deleteModal.hidden = true;
    deleteBackdrop.hidden = true;
    document.body.classList.remove("modal-open");
    pendingDeleteId = null;
    if (deleteReturnFocus && document.body.contains(deleteReturnFocus)) deleteReturnFocus.focus();
}

deleteCancel.addEventListener("click", closeDelete);
deleteBackdrop.addEventListener("click", closeDelete);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !deleteModal.hidden) closeDelete();
});

deleteConfirm.addEventListener("click", async () => {
    const id = pendingDeleteId;
    const situation = situations.find((s) => s.id === id);

    deleteConfirm.disabled = true;

    try {
        await SituationsApi.remove(id);
    } catch (error) {
        closeDelete();
        showStatus(error.message, true);
        return;
    } finally {
        deleteConfirm.disabled = false;
    }

    situations = situations.filter((s) => s.id !== id);
    deleteReturnFocus = searchInput;
    closeDelete();

    if (editingId === id) {
        setEditing(null);
    } else {
        renderSituations();
    }

    showStatus(`"${situation.name}" was deleted.`);
});

async function init() {
    submitButton.disabled = true;
    situationGrid.replaceChildren(el("p", { class: "cs-empty", text: "Loading situations..." }));

    try {
        const data = await SituationsApi.load();
        ENTITIES = data.entities;
        rooms = data.rooms;
        situations = data.rules;
    } catch (error) {
        situationGrid.replaceChildren(el("p", { class: "cs-empty", text: error.message }));
        showStatus(error.message, true);
        return;
    }

    submitButton.disabled = false;
    setEditing(null);
}

init();
