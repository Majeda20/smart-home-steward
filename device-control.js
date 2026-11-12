document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("device-control-panel");
    const summary = document.getElementById("device-summary");
    const refreshButton = document.getElementById("device-refresh");
    const filterBar = document.getElementById("device-filters");

    const backdrop = document.getElementById("dc-backdrop");
    const dialog = document.getElementById("dc-confirm");
    const dialogTitle = document.getElementById("dc-confirm-title");
    const dialogText = document.getElementById("dc-confirm-text");
    const cancelButton = document.getElementById("dc-confirm-cancel");
    const confirmButton = document.getElementById("dc-confirm-ok");

    const groupBackdrop = document.getElementById("dc-group-backdrop");
    const groupModal = document.getElementById("dc-group");
    const groupTitle = document.getElementById("dc-group-title");
    const groupSubtitle = document.getElementById("dc-group-subtitle");
    const groupBulk = document.getElementById("dc-group-bulk");
    const groupList = document.getElementById("dc-group-list");
    const groupClose = document.getElementById("dc-group-close");

    if (!panel || !dialog || !backdrop || !cancelButton || !confirmButton ||
        !groupModal || !groupBackdrop || !groupList) {
        return;
    }

    const VERIFY_ATTEMPTS = 12;
    const VERIFY_DELAY_MS = 500;
    const DEVICES_TIMEOUT_MS = 10000;
    const KEYBOARD_COMMIT_MS = 700;
    const SUCCESS_VISIBLE_MS = 6000;
    const MEMBER_PREVIEW_LIMIT = 6;
    const FILTERS_FROM_CARDS = 5;
    const REFRESH_MS = 3000;
    const HOLD_DELAY_MS = 500;
    const HOLD_REPEAT_MS = 200;

    const DOMAIN_LABELS = {
        light: "Light",
        switch: "Switch",
        fan: "Fan",
        input_boolean: "Virtual switch",
        climate: "Climate",
        cover: "Blinds / cover",
        door: "Door",
        window: "Window",
        ventilation: "Ventilation",
        motion: "Motion sensor",
        presence: "Presence sensor"
    };

    const DOMAIN_PLURALS = {
        light: "Lights",
        switch: "Switches",
        fan: "Fans",
        input_boolean: "Virtual switches",
        climate: "Climate",
        cover: "Blinds",
        door: "Doors",
        window: "Windows",
        ventilation: "Ventilation",
        motion: "Motion",
        presence: "Presence"
    };

    const STATUS_ONLY_DOMAINS = ["door", "window", "motion", "presence"];
    const ACTIVE_STATES = ["open", "detected"];

    const ACTIONS = {
        turn_on: {
            label: "On", all: "All on", verb: "Turn on",
            progress: "Turning on", done: "Turned on"
        },
        turn_off: {
            label: "Off", all: "All off", verb: "Turn off",
            progress: "Turning off", done: "Turned off"
        },
        open_cover: {
            label: "Open", all: "Open all", verb: "Open",
            progress: "Opening", done: "Opening"
        },
        stop_cover: {
            label: "Stop", all: "Stop all", verb: "Stop",
            progress: "Stopping", done: "Stopped"
        },
        close_cover: {
            label: "Close", all: "Close all", verb: "Close",
            progress: "Closing", done: "Closing"
        },
        set_temperature: {
            label: "Set", all: "Set", verb: "Set",
            progress: "Setting", done: "Temperature set"
        },
        set_brightness: {
            label: "Brightness", all: "Brightness", verb: "Dim",
            progress: "Dimming", done: "Brightness set"
        },
        set_position: {
            label: "Position", all: "Position", verb: "Move",
            progress: "Moving", done: "Position set"
        },
        set_mode: {
            label: "Mode", all: "Mode", verb: "Set mode",
            progress: "Changing mode", done: "Mode set"
        }
    };

    const ON_STATES = ["on", "open", "opening", "heat", "cool",
        "heat_cool", "auto", "dry", "fan_only"];
    const OFF_STATES = ["off", "closed", "closing"];

    let room = null;
    let devices = [];
    let items = [];
    let filter = "all";
    let openGroupKey = null;
    let roomToken = 0;
    let loadToken = 0;
    let sliding = false;
    let renderQueued = false;
    let holdTimer = null;
    let detecting = false;

    const statuses = new Map();
    const statusTimers = new Map();
    const drafts = new Map();

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const byName = (a, b) => a.name.localeCompare(
        b.name, undefined, { numeric: true, sensitivity: "base" }
    );

    function el(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function button(className, text, key) {
        const element = el("button", className, text);
        element.type = "button";
        if (key) element.dataset.key = key;
        return element;
    }

    function plural(count, word) {
        return `${count} ${word}${count !== 1 ? "s" : ""}`;
    }

    function formatState(state) {
        if (!state) return "Unknown";
        const text = state.replace(/_/g, " ");
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function decimalsFor(step) {
        return step < 1 ? 1 : 0;
    }

    const userPreferences = document.getElementById("user-preferences");
    const showFahrenheit = userPreferences !== null
        && userPreferences.dataset.temperatureUnit === "fahrenheit";

    function formatTemp(value, step = 0.5) {
        if (value === null || value === undefined) return "--";

        return showFahrenheit
            ? `${(value * 9 / 5 + 32).toFixed(1)} °F`
            : `${value.toFixed(decimalsFor(step))} °C`;
    }

    function nowLabel() {
        const time = new Date();
        const pad = number => String(number).padStart(2, "0");
        return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
    }

    async function fetchJson(url, options = {}, timeoutMs = DEVICES_TIMEOUT_MS) {
        let response;
        let data;

        try {
            response = await fetch(url, {
                credentials: "same-origin",
                ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
                ...options
            });

            data = await response.json();
        } catch (error) {
            if (error.name === "TimeoutError") {
                const timeout = new Error("Home Assistant is not responding. Please try again later.");
                timeout.timedOut = true;
                throw timeout;
            }

            throw error;
        }

        if (!response.ok) {
            const failure = new Error(data.error || "Request failed.");
            failure.results = data.results;
            throw failure;
        }

        return data;
    }

    async function fetchDevices(roomId) {
        const data = await fetchJson(
            `api/room-devices.php?room=${encodeURIComponent(roomId)}`
        );

        return data.devices;
    }

    async function sendCommand(roomId, entityIds, action, value) {
        return fetchJson("api/device-command.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                room: roomId,
                entity_ids: entityIds,
                action,
                value
            })
        }, null);
    }

    function baseName(name) {
        const trimmed = name.trim();
        const base = trimmed.replace(/[\s_#-]*\d+$/, "").trim();
        return base || trimmed;
    }

    function groupAvailability(members) {
        if (members.every(d => d.availability === "unavailable")) {
            return "unavailable";
        }

        if (members.some(d => d.availability === "available")) {
            return "available";
        }

        return "unknown";
    }

    function buildItems(list) {
        const groups = new Map();

        list.forEach(device => {
            const base = baseName(device.name);
            const key = `${device.domain}:${base.toLowerCase()}`;

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    name: base,
                    domain: device.domain,
                    devices: []
                });
            }

            groups.get(key).devices.push(device);
        });

        const result = [];

        groups.forEach(group => {
            if (group.devices.length > 1) {
                group.devices.sort(byName);

                result.push({
                    type: "group",
                    ...group,
                    id: `group:${group.key}`,
                    availability: groupAvailability(group.devices)
                });
            } else {
                const device = group.devices[0];

                result.push({
                    type: "single",
                    device,
                    id: device.entity_id,
                    name: device.name,
                    domain: device.domain,
                    availability: device.availability
                });
            }
        });

        const order = { available: 0, unknown: 1, unavailable: 2 };

        return result.sort((a, b) =>
            order[a.availability] - order[b.availability] || byName(a, b)
        );
    }

    function findGroup(key) {
        return items.find(
            item => item.type === "group" && item.key === key
        ) || null;
    }

    function isPending(id) {
        const status = statuses.get(id);
        return Boolean(status && status.type === "pending");
    }

    function anyPending() {
        return [...statuses.values()].some(
            status => status.type === "pending"
        );
    }

    function groupBusy(group) {
        return isPending(group.id) ||
            group.devices.some(d => isPending(d.entity_id));
    }

    function setStatus(id, type, text) {
        clearTimeout(statusTimers.get(id));
        statusTimers.delete(id);

        if (type === null) {
            statuses.delete(id);
        } else {
            statuses.set(id, { type, text });
        }

        if (type === "success") {
            statusTimers.set(id, setTimeout(() => {
                statuses.delete(id);
                statusTimers.delete(id);
                render();
            }, SUCCESS_VISIBLE_MS));
        }

        render();
    }

    function resetRoomState() {
        stopHold();
        statusTimers.forEach(timer => clearTimeout(timer));
        statusTimers.clear();
        statuses.clear();
        drafts.clear();
        devices = [];
        items = [];
        filter = "all";
        closeGroup(false);
    }

    function renderStatusLine(status) {
        const line = el("p", "dc-status");
        line.setAttribute("role", "status");

        if (!status) {
            line.hidden = true;
            return line;
        }

        line.classList.add(`dc-status-${status.type}`);

        if (status.type === "pending") {
            const spinner = el("span", "dc-spinner");
            spinner.setAttribute("aria-hidden", "true");
            line.append(spinner);
        }

        line.append(document.createTextNode(status.text));
        return line;
    }

    function focusKey(key) {
        if (!key) return;

        const root = openGroupKey ? groupModal : document;

        const target = root.querySelector(
            `[data-key="${CSS.escape(key)}"]`
        );

        if (target && !target.disabled) {
            target.focus({ preventScroll: true });
            return;
        }

        const id = key.slice(0, key.lastIndexOf("|"));
        const card = root.querySelector(
            `[data-entity="${CSS.escape(id)}"]`
        );

        if (card) {
            card.focus({ preventScroll: true });
        } else if (openGroupKey && groupClose) {
            groupClose.focus({ preventScroll: true });
        }
    }

    function currentFocusKey() {
        const active = document.activeElement;

        if (!active ||
            !(panel.contains(active) || groupModal.contains(active) ||
              (filterBar && filterBar.contains(active)))) {
            return null;
        }

        if (active.dataset.key) return active.dataset.key;
        if (active.dataset.entity) return `${active.dataset.entity}|card`;

        return null;
    }

    function showMessage(text, isError = false) {
        const message = el("div", "dc-message");
        message.append(el("p", "", text));

        if (isError) {
            message.classList.add("is-error");
            message.setAttribute("role", "alert");
        }

        panel.replaceChildren(message);

        if (summary) summary.hidden = true;
        if (filterBar) filterBar.hidden = true;
    }

    function renderSummary() {
        if (!summary) return;

        const total = devices.length;
        const unavailable = devices.filter(
            device => device.availability === "unavailable"
        ).length;
        const unknown = devices.filter(
            device => device.availability === "unknown"
        ).length;

        const parts = [
            plural(total, "device"),
            `${total - unavailable - unknown} available`
        ];

        if (unknown) parts.push(`${unknown} unknown`);
        if (unavailable) parts.push(`${unavailable} unavailable`);

        summary.textContent = parts.join(" · ");
        summary.hidden = false;
    }

    function renderFilters() {
        if (!filterBar) return;

        const domains = [...new Set(items.map(item => item.domain))];

        if (domains.length < 2 || items.length < FILTERS_FROM_CARDS) {
            filter = "all";
            filterBar.hidden = true;
            return;
        }

        if (filter !== "all" && !domains.includes(filter)) {
            filter = "all";
        }

        const countDevices = domain => devices.filter(
            device => domain === "all" || device.domain === domain
        ).length;

        const options = ["all", ...domains.sort()];

        filterBar.replaceChildren(...options.map(domain => {
            const label = domain === "all"
                ? "All"
                : DOMAIN_PLURALS[domain] || "Other";

            const chip = button(
                "dc-filter",
                `${label} (${countDevices(domain)})`,
                `filter|${domain}`
            );

            chip.setAttribute("aria-pressed", String(filter === domain));

            chip.addEventListener("click", () => {
                filter = domain;
                render();
            });

            return chip;
        }));

        filterBar.hidden = false;
    }

    function render() {
        if (!room) return;

        if (sliding) {
            renderQueued = true;
            return;
        }

        items = buildItems(devices);

        if (devices.length === 0) {
            showMessage("No controllable devices found in this room.");
            closeGroup(false);
            return;
        }

        const activeKey = currentFocusKey();

        renderFilters();

        const visible = items.filter(
            item => filter === "all" || item.domain === filter
        );
        const isStatusOnly = item => STATUS_ONLY_DOMAINS.includes(item.domain);

        const statusDevices = visible
            .filter(isStatusOnly)
            .flatMap(item => item.type === "group" ? item.devices : [item.device]);

        const list = el("div", "dc-device-list");

        visible
            .filter(item => !isStatusOnly(item))
            .forEach(item => {
                list.append(item.type === "group"
                    ? renderGroupCard(item)
                    : renderDevice(item.device));
            });

        const sections = [];

        if (statusDevices.length) {
            sections.push(renderStatusSection(statusDevices));
        }

        if (list.children.length) {
            if (statusDevices.length) {
                sections.push(renderSectionHeading(
                    "Devices",
                    "Control these devices from the app."
                ));
            }

            sections.push(list);
        }

        panel.replaceChildren(...sections);
        renderSummary();
        renderGroupModal();

        focusKey(activeKey);
    }

    function renderDevice(device, { compact = false } = {}) {
        const pending = isPending(device.entity_id);
        const unavailable = device.availability === "unavailable";

        const card = el("article", "dc-device");
        card.dataset.entity = device.entity_id;
        card.tabIndex = -1;
        card.classList.add(`is-${device.availability}`);
        if (compact) card.classList.add("is-compact");
        if (pending) card.classList.add("is-pending");
        card.setAttribute("aria-busy", String(pending));

        const header = el("div", "dc-device-header");
        const text = el("div", "dc-device-text");

        const name = el("h3", "dc-device-name", device.name);
        name.title = device.entity_id;

        const meta = el(
            "p",
            "dc-device-meta",
            compact
                ? describeState(device)
                : `${DOMAIN_LABELS[device.domain] || "Device"} · ` +
                  describeState(device)
        );

        text.append(name, meta);
        header.append(text, renderBadge(device.availability));
        card.append(header);

        const controls = el("div", "dc-device-controls");

        if (unavailable) {
            controls.append(el(
                "p",
                "dc-device-note",
                compact
                    ? "Offline - controls disabled."
                    : "This device is offline. " +
                      "Controls are disabled until it is back online."
            ));
        } else if (device.domain === "climate") {
            controls.append(renderClimateControls(device, pending));
        } else if (device.light) {
            controls.append(renderLightControls(device, pending));
        } else if (device.cover) {
            controls.append(renderCoverControls(device, pending));
        } else if (device.ventilation) {
            controls.append(renderVentilationControls(device, pending));
        } else {
            controls.append(renderButtonGroup(
                device,
                actionsFor(device.domain),
                pending
            ));
        }

        if (device.availability === "unknown" && !compact) {
            controls.append(el(
                "p",
                "dc-device-note",
                "The device does not report its state, so the result " +
                "of an action may not be confirmed."
            ));
        }

        card.append(controls);
        card.append(renderStatusLine(statuses.get(device.entity_id)));

        return card;
    }

    function renderBadge(availability) {
        const text = {
            available: "Available",
            unknown: "State unknown",
            unavailable: "Unavailable"
        }[availability];

        return el("span", `dc-badge dc-badge-${availability}`, text);
    }

    function actionsFor(domain) {
        if (domain === "cover") {
            return ["open_cover", "stop_cover", "close_cover"];
        }

        if (domain === "climate" || domain === "ventilation" ||
            STATUS_ONLY_DOMAINS.includes(domain)) {
            return [];
        }

        return ["turn_on", "turn_off"];
    }

    function alreadyIn(device, action) {
        if (device.domain === "climate") {
            return (action === "turn_on" && device.state !== "off") ||
                (action === "turn_off" && device.state === "off");
        }

        const partlyOpen = Boolean(device.cover) &&
            device.cover.position !== null &&
            device.cover.position < 100;

        return (action === "turn_on" && device.state === "on") ||
            (action === "turn_off" && device.state === "off") ||
            (action === "open_cover" && device.state === "opening") ||
            (action === "open_cover" && device.state === "open" &&
                !partlyOpen) ||
            (action === "close_cover" &&
                ["closed", "closing"].includes(device.state));
    }

    function describeState(device) {
        if (device.domain === "climate" && device.climate &&
            device.availability !== "unavailable") {
            const { current, target, step } = device.climate;
            return `${formatState(device.state)} · ` +
                `Now ${formatTemp(current, step)} · ` +
                `Target ${formatTemp(target, step)}`;
        }

        if (device.light && device.state === "on") {
            return `On · ${device.light.brightness}%`;
        }

        if (device.cover && device.cover.position !== null &&
            ["open", "closed"].includes(device.state)) {
            return device.cover.position === 0
                ? "Closed"
                : `${device.cover.position}% open`;
        }

        if (device.ventilation && device.ventilation.airflow !== null &&
            device.availability !== "unavailable") {
            return `${formatState(device.state)} · ` +
                `Airflow ${device.ventilation.airflow} ${device.ventilation.unit}`;
        }

        return formatState(device.state);
    }

    function renderButtonGroup(device, actions, pending) {
        const group = el("div", "dc-segmented");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", `${device.name} controls`);

        actions.forEach(action => {
            const segment = button(
                "dc-segment",
                ACTIONS[action].label,
                `${device.entity_id}|${action}`
            );

            segment.disabled = pending;

            const active = alreadyIn(device, action);

            if (action !== "stop_cover") {
                segment.setAttribute("aria-pressed", String(active));
            }

            segment.addEventListener("click", () => {
                if (active && device.availability === "available") return;
                requestAction(device, action);
            });

            group.append(segment);
        });

        return group;
    }

    function renderVentilationControls(device, pending) {
        const group = el("div", "dc-segmented");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", `${device.name} mode`);

        device.ventilation.modes.forEach(mode => {
            const key = `${device.entity_id}|set_mode:${mode}`;
            const segment = button("dc-segment", formatState(mode), key);
            const active = device.state === mode;

            segment.disabled = pending;
            segment.setAttribute("aria-pressed", String(active));

            segment.addEventListener("click", () => {
                if (active && device.availability === "available") return;
                requestAction(device, "set_mode", mode, key);
            });

            group.append(segment);
        });

        return group;
    }

    function renderLevelSlider(device, current, action, name, pending, value) {
        const id = device.entity_id;

        const level = drafts.has(id) ? drafts.get(id) : current;

        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "dc-brightness-slider";
        slider.min = "0";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(level);
        slider.dataset.key = `${id}|${action}`;
        slider.disabled = pending;
        slider.setAttribute("aria-label", `${device.name} ${name}`);

        const track = el("div", "dc-md-slider");
        track.append(
            el("span", "dc-md-active"),
            el("span", "dc-md-handle"),
            el("span", "dc-md-inactive"),
            slider
        );

        const showLevel = next => {
            track.style.setProperty("--level", next);
            track.dataset.level = next;
            value.textContent = `${next}%`;
        };

        showLevel(level);

        let usingPointer = false;
        let keyTimer = null;

        const commit = async () => {
            const target = Number(slider.value);

            if (target !== current) {
                await runAction(device, action, target);
            }

            drafts.delete(id);
            render();
        };

        slider.addEventListener("pointerdown", () => {
            usingPointer = true;
            sliding = true;
        });

        slider.addEventListener("keydown", () => {
            usingPointer = false;
        });

        slider.addEventListener("input", () => {
            if (!usingPointer) sliding = true;

            drafts.set(id, Number(slider.value));
            showLevel(Number(slider.value));
        });

        slider.addEventListener("change", () => {
            if (usingPointer) {
                usingPointer = false;
                commit();
                return;
            }

            clearTimeout(keyTimer);
            keyTimer = setTimeout(() => {
                sliding = false;
                renderQueued = false;
                commit();
            }, KEYBOARD_COMMIT_MS);
        });

        return track;
    }

    function renderLightControls(device, pending) {
        const wrapper = el("div", "dc-light");
        const label = el("label", "dc-brightness");
        const value = el("output", "dc-brightness-value");

        label.append(
            renderLevelSlider(
                device, device.light.brightness, "set_brightness",
                "brightness", pending, value
            ),
            value
        );

        wrapper.append(
            renderButtonGroup(device, actionsFor(device.domain), pending),
            label
        );

        return wrapper;
    }

    function renderStatusTile(device) {
        const tile = el("article", "dc-status-tile");
        tile.dataset.entity = device.entity_id;

        const text = el("div", "dc-status-tile-text");
        const name = el("h3", "dc-status-tile-name", device.name);
        name.title = device.entity_id;

        text.append(
            name,
            el("p", "dc-status-tile-type", DOMAIN_LABELS[device.domain] || "Device")
        );

        const unavailable = device.availability === "unavailable";
        const isOpen = !unavailable && ACTIVE_STATES.includes(device.state);

        const status = el(
            "span",
            `dc-opening ${isOpen ? "is-open" : "is-closed"}`,
            unavailable ? "Offline" : formatState(device.state)
        );

        tile.append(text, status);

        return tile;
    }

    function renderSectionHeading(title, text) {
        const heading = el("div", "dc-status-heading");
        heading.append(el("h3", "", title), el("p", "", text));
        return heading;
    }

    function renderStatusSection(statusDevices) {
        const section = el("section", "dc-status-section");
        const heading = renderSectionHeading(
            "Sensors",
            "Doors, windows, motion and presence. Status only - these cannot be controlled from the app."
        );

        const grid = el("div", "dc-status-grid");
        grid.append(...statusDevices.map(renderStatusTile));

        section.append(heading, grid);

        return section;
    }

    function renderCoverControls(device, pending) {
        const wrapper = el("div", "dc-cover");
        const position = el("div", "dc-position");
        const head = el("div", "dc-position-head");
        const value = el("output", "dc-position-value");
        const label = el("label", "dc-position-track");
        const ends = el("div", "dc-position-ends");

        head.append(el("span", "", "Position"), value);

        const track = renderLevelSlider(
            device, device.cover.position ?? 0, "set_position",
            "position", pending, value
        );
        track.classList.add("is-purple");
        label.append(track);

        ends.append(el("span", "", "Closed"), el("span", "", "Open"));

        position.append(head, label, ends);

        wrapper.append(
            renderButtonGroup(device, actionsFor(device.domain), pending),
            position
        );

        return wrapper;
    }

    function endSlide() {
        if (!sliding) return;

        setTimeout(() => {
            sliding = false;

            if (renderQueued) {
                renderQueued = false;
                render();
            }
        }, 0);
    }

    document.addEventListener("pointerup", endSlide);
    document.addEventListener("pointercancel", endSlide);

    function stopHold() {
        clearTimeout(holdTimer);
        holdTimer = null;
    }

    function holdToRepeat(element, step) {
        element.addEventListener("pointerdown", event => {
            if (event.button !== 0 || element.disabled) return;

            stopHold();

            if (!step()) return;

            const repeat = delay => {
                holdTimer = setTimeout(() => {
                    if (step()) {
                        repeat(HOLD_REPEAT_MS);
                    } else {
                        stopHold();
                    }
                }, delay);
            };

            repeat(HOLD_DELAY_MS);
        });

        element.addEventListener("click", event => {
            if (event.detail === 0) step();
        });

        element.addEventListener("contextmenu", event => {
            event.preventDefault();
        });
    }

    document.addEventListener("pointerup", stopHold);
    document.addEventListener("pointercancel", stopHold);
    window.addEventListener("blur", stopHold);

    function renderClimateControls(device, pending) {
        const climate = device.climate;
        const temperature = renderTemperatureControls(device, pending);

        if (!climate || !climate.switch) return temperature;

        const wrapper = el("div", "dc-heating");
        wrapper.append(
            renderButtonGroup(device, ["turn_on", "turn_off"], pending),
            temperature
        );

        return wrapper;
    }

    function renderTemperatureControls(device, pending) {
        const wrapper = el("div", "dc-climate");
        const climate = device.climate;

        if (!climate || climate.target === null) {
            wrapper.append(el(
                "p",
                "dc-device-note",
                "This device does not offer a single target temperature."
            ));
            return wrapper;
        }

        const { min, max, step } = climate;
        const decimals = decimalsFor(step);

        const draft = drafts.has(device.entity_id)
            ? drafts.get(device.entity_id)
            : climate.target;

        const changeDraft = delta => {
            if (isPending(device.entity_id)) return false;

            const current = drafts.has(device.entity_id)
                ? drafts.get(device.entity_id)
                : climate.target;
            const next = Number(
                Math.min(max, Math.max(min, current + delta)).toFixed(decimals)
            );

            if (next === current) return false;

            drafts.set(device.entity_id, next);
            render();
            return true;
        };

        const stepper = el("div", "dc-stepper");

        const minus = button("dc-step", "−", `${device.entity_id}|minus`);
        minus.setAttribute("aria-label", "Lower target temperature");
        minus.disabled = pending || draft <= min;
        holdToRepeat(minus, () => changeDraft(-step));

        const value = el("output", "dc-step-value", formatTemp(draft, step));
        value.setAttribute("aria-live", "polite");

        const plus = button("dc-step", "+", `${device.entity_id}|plus`);
        plus.setAttribute("aria-label", "Raise target temperature");
        plus.disabled = pending || draft >= max;
        holdToRepeat(plus, () => changeDraft(step));

        stepper.append(minus, value, plus);

        const changed = Math.abs(draft - climate.target) > 0.001;

        const apply = button(
            "dc-btn dc-btn-primary",
            "Set",
            `${device.entity_id}|set_temperature`
        );
        apply.disabled = pending || !changed;
        apply.addEventListener("click", () => {
            requestAction(device, "set_temperature", draft);
        });

        wrapper.append(stepper, apply);
        return wrapper;
    }

    function stateCounts(members) {
        const counts = new Map();

        members.forEach(device => {
            const label = device.availability === "unavailable"
                ? "unavailable"
                : formatState(device.state).toLowerCase();

            counts.set(label, (counts.get(label) || 0) + 1);
        });

        return [...counts.entries()]
            .sort(([a], [b]) =>
                (a === "unavailable") - (b === "unavailable"))
            .map(([label, count]) => `${count} ${label}`)
            .join(" · ");
    }

    function memberDotClass(device) {
        if (device.availability === "unavailable") return "is-unavailable";
        if (device.availability === "unknown") return "is-unknown";
        if (ON_STATES.includes(device.state)) return "is-on";
        if (OFF_STATES.includes(device.state)) return "is-off";
        return "is-unknown";
    }

    function eligibleFor(device, action) {
        return device.availability !== "unavailable" &&
            !isPending(device.entity_id) &&
            !alreadyIn(device, action);
    }

    function renderBulkButtons(group) {
        const actions = actionsFor(group.domain);

        if (actions.length === 0) return null;

        const busy = groupBusy(group);
        const reachable = group.devices.filter(
            d => d.availability !== "unavailable"
        );

        const bar = el("div", "dc-segmented");
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", `All ${group.name} devices`);

        actions.forEach(action => {
            const targets = group.devices.filter(
                d => eligibleFor(d, action)
            );

            const segment = button(
                "dc-segment",
                ACTIONS[action].all,
                `${group.id}|${action}`
            );

            const allThere = action !== "stop_cover" &&
                reachable.length > 0 &&
                reachable.every(d => alreadyIn(d, action));

            if (action !== "stop_cover") {
                segment.setAttribute("aria-pressed", String(allThere));
            }

            segment.disabled = busy || reachable.length === 0 ||
                (targets.length === 0 && !allThere);

            segment.addEventListener("click", () => {
                if (allThere) return;
                requestBulk(group, action);
            });

            bar.append(segment);
        });

        return bar;
    }

    function groupCardStatus(group) {
        const own = statuses.get(group.id);

        if (own && own.type === "failed") {
            return { ...own, text: `${own.text} Open the list for details.` };
        }

        if (own) return own;

        const pending = group.devices.filter(d => isPending(d.entity_id));

        if (pending.length) {
            return {
                type: "pending",
                text: pending.length === 1
                    ? `Updating ${pending[0].name}...`
                    : `Updating ${pending.length} devices...`
            };
        }

        const failed = group.devices.filter(d => {
            const status = statuses.get(d.entity_id);
            return status && status.type === "failed";
        });

        if (failed.length) {
            return {
                type: "failed",
                text: `${plural(failed.length, "device")} failed. ` +
                    "Open the list for details."
            };
        }

        return null;
    }

    function renderGroupCard(group) {
        const card = el("article", "dc-device dc-group-card");
        card.dataset.entity = group.id;
        card.tabIndex = -1;
        card.classList.add(`is-${group.availability}`);

        const busy = groupBusy(group);
        if (busy) card.classList.add("is-pending");
        card.setAttribute("aria-busy", String(busy));

        const header = el("div", "dc-device-header");
        const text = el("div", "dc-device-text");

        text.append(
            el("h3", "dc-device-name", group.name),
            el(
                "p",
                "dc-device-meta",
                `${DOMAIN_PLURALS[group.domain] || "Devices"} · ` +
                stateCounts(group.devices)
            )
        );

        header.append(
            text,
            el("span", "dc-badge dc-badge-count",
                plural(group.devices.length, "device"))
        );

        card.append(header);

        const members = el("ul", "dc-members");
        members.setAttribute("aria-label", `${group.name} devices`);

        group.devices.slice(0, MEMBER_PREVIEW_LIMIT).forEach(device => {
            const member = el("li", `dc-member ${memberDotClass(device)}`);
            member.title = `${device.name}: ` + (
                device.availability === "unavailable"
                    ? "Unavailable"
                    : formatState(device.state)
            );
            member.append(el("span", "dc-member-dot"));
            member.append(document.createTextNode(device.name));
            members.append(member);
        });

        const hidden = group.devices.length - MEMBER_PREVIEW_LIMIT;

        if (hidden > 0) {
            members.append(el("li", "dc-member dc-member-more", `+${hidden} more`));
        }

        card.append(members);

        const controls = el("div", "dc-device-controls");
        const bulk = renderBulkButtons(group);

        if (bulk) controls.append(bulk);

        const choose = button(
            bulk ? "dc-btn dc-btn-secondary dc-btn-block"
                 : "dc-btn dc-btn-primary dc-btn-block",
            bulk ? "Choose a device" : "Manage devices",
            `${group.id}|open`
        );

        choose.setAttribute("aria-haspopup", "dialog");
        choose.addEventListener("click", () => openGroup(group.key));
        controls.append(choose);

        card.append(controls);
        card.append(renderStatusLine(groupCardStatus(group)));

        return card;
    }

    function renderGroupModal() {
        if (!openGroupKey) return;

        const group = findGroup(openGroupKey);

        if (!group) {
            closeGroup(false);
            return;
        }

        groupTitle.textContent = group.name;
        groupSubtitle.textContent =
            `${room ? room.name : "Room"} · ` +
            `${plural(group.devices.length, "device")} · ` +
            stateCounts(group.devices);

        const bulk = renderBulkButtons(group);
        const status = statuses.get(group.id);

        groupBulk.replaceChildren();

        if (bulk) groupBulk.append(bulk);
        if (status) groupBulk.append(renderStatusLine(status));

        groupBulk.hidden = !bulk && !status;

        groupList.replaceChildren(...group.devices.map(
            device => renderDevice(device, { compact: true })
        ));
    }

    function openGroup(key) {
        openGroupKey = key;

        groupBackdrop.hidden = false;
        groupModal.hidden = false;
        document.body.style.overflow = "hidden";

        renderGroupModal();

        if (groupClose) groupClose.focus();
    }

    function closeGroup(restoreFocus = true) {
        if (!openGroupKey) return;

        const key = openGroupKey;
        openGroupKey = null;

        groupBackdrop.hidden = true;
        groupModal.hidden = true;
        document.body.style.overflow = "";

        if (restoreFocus) focusKey(`group:${key}|open`);
    }

    if (groupClose) {
        groupClose.addEventListener("click", () => closeGroup());
    }

    groupBackdrop.addEventListener("click", () => closeGroup());

    document.addEventListener("keydown", event => {
        if (!openGroupKey || !dialog.hidden) return;

        if (event.key === "Escape") {
            event.preventDefault();
            closeGroup();
        }

        if (event.key === "Tab") {
            if (!groupModal.contains(document.activeElement)) {
                event.preventDefault();
                if (groupClose) groupClose.focus();
                return;
            }

            trapFocus(event, groupModal);
        }
    });

    function trapFocus(event, container) {
        const focusable = [...container.querySelectorAll(
            "button:not(:disabled), [href], input, select, textarea"
        )].filter(element => element.offsetParent !== null);

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

    function mergeDevices(list) {
        const fresh = new Map(list.map(device => [device.entity_id, device]));

        return devices.map(device =>
            fresh.get(device.entity_id) ||
            { ...device, availability: "unavailable" }
        );
    }

    async function loadDevices({ silent = false, statesOnly = false } = {}) {
        if (!room) return;

        if (statesOnly && detecting) return;

        const token = ++loadToken;
        const roomAtStart = roomToken;

        if (!statesOnly) {
            detecting = true;
            if (refreshButton) refreshButton.disabled = true;
        }

        if (!silent) {
            panel.setAttribute("aria-busy", "true");
            showMessage("Loading devices...");
        }

        try {
            const list = await fetchDevices(room.id);

            if (token !== loadToken || roomAtStart !== roomToken) return;

            devices = statesOnly ? mergeDevices(list) : list;
            render();
        } catch (error) {
            if (token !== loadToken || roomAtStart !== roomToken) return;

            console.error(error);

            if (!silent || devices.length === 0) {
                closeGroup(false);
                showMessage(
                    error.timedOut
                        ? error.message
                        : "Could not load devices. Please try again later.",
                    true
                );
            }
        } finally {
            if (token === loadToken) {
                panel.setAttribute("aria-busy", "false");
            }

            if (!statesOnly && roomAtStart === roomToken) {
                detecting = false;
                if (refreshButton) refreshButton.disabled = false;
            }
        }
    }

    let confirmResolve = null;
    let confirmReturnKey = null;

    function openConfirm({ title, text, confirmLabel, returnKey }) {
        return new Promise(resolve => {
            confirmResolve = resolve;
            confirmReturnKey = returnKey;

            dialogTitle.textContent = title;
            dialogText.textContent = text;
            confirmButton.textContent = confirmLabel;

            backdrop.hidden = false;
            dialog.hidden = false;
            document.body.style.overflow = "hidden";

            cancelButton.focus();
        });
    }

    function closeConfirm(confirmed) {
        if (!confirmResolve) return;

        const resolve = confirmResolve;
        confirmResolve = null;

        backdrop.hidden = true;
        dialog.hidden = true;

        document.body.style.overflow = openGroupKey ? "hidden" : "";

        focusKey(confirmReturnKey);
        resolve(confirmed);
    }

    cancelButton.addEventListener("click", () => closeConfirm(false));
    confirmButton.addEventListener("click", () => closeConfirm(true));
    backdrop.addEventListener("click", () => closeConfirm(false));

    dialog.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeConfirm(false);
        }

        if (event.key === "Tab") trapFocus(event, dialog);
    });

    function confirmationFor(device, action, value) {
        const roomName = room ? room.name : "this room";

        if (action === "set_temperature") {
            const step = device.climate ? device.climate.step : 0.5;

            return {
                title: "Change temperature?",
                text: `Set "${device.name}" in ${roomName} to ` +
                    `${formatTemp(value, step)}?`,
                confirmLabel: "Set temperature"
            };
        }

        if (action === "set_mode") {
            return {
                title: "Change ventilation mode?",
                text: `Set "${device.name}" in ${roomName} to ` +
                    `${formatState(value)}?`,
                confirmLabel: "Set mode"
            };
        }

        const verb = ACTIONS[action].verb;

        return {
            title: `${verb} device?`,
            text: `${verb} "${device.name}" in ${roomName}?`,
            confirmLabel: verb
        };
    }

    async function requestAction(device, action, value = null,
        returnKey = `${device.entity_id}|${action}`) {
        if (isPending(device.entity_id) || !dialog.hidden) return;

        const confirmed = await openConfirm({
            ...confirmationFor(device, action, value),
            returnKey
        });

        if (!confirmed) return;

        runAction(device, action, value);
    }

    async function requestBulk(group, action) {
        if (groupBusy(group) || !dialog.hidden) return;

        const targets = group.devices.filter(d => eligibleFor(d, action));

        if (targets.length === 0) return;

        const skipped = group.devices.filter(
            d => d.availability === "unavailable"
        ).length;

        const verb = ACTIONS[action].verb;
        const roomName = room ? room.name : "this room";

        let text = `${verb} ${plural(targets.length, "device")} in ` +
            `${roomName}: ${targets.map(d => d.name).join(", ")}.`;

        if (skipped) {
            text += ` ${plural(skipped, "unavailable device")} ` +
                `will be skipped.`;
        }

        const confirmed = await openConfirm({
            title: `${verb} ${group.name} devices?`,
            text,
            confirmLabel: `${verb} ${targets.length}`,
            returnKey: `${group.id}|${action}`
        });

        if (!confirmed) return;

        runBulk(group, action, targets);
    }

    async function runBulk(group, action, targets) {
        const roomAtStart = roomToken;
        const config = ACTIONS[action];

        setStatus(
            group.id,
            "pending",
            `${config.progress} ${plural(targets.length, "device")}...`
        );

        const results = await runCommand(targets, action, null);

        if (roomAtStart !== roomToken) return;

        const total = targets.length;
        const ok = results.filter(r => r === "success").length;
        const failed = results.filter(r => r === "failed").length;
        const waiting = total - ok - failed;

        if (ok === total) {
            setStatus(
                group.id,
                "success",
                `${config.done}: ${plural(ok, "device")} · ${nowLabel()}`
            );
        } else if (failed) {
            setStatus(
                group.id,
                "failed",
                `${ok} of ${total} done, ${failed} failed.`
            );
        } else {
            setStatus(
                group.id,
                "unconfirmed",
                ok === 0
                    ? "Command sent, but the devices have not confirmed the change yet."
                    : `Confirmed on ${ok} of ${total} devices. ` +
                      `${plural(waiting, "device")} ${waiting === 1 ? "has" : "have"} not confirmed yet.`
            );
        }
    }

    function reachedTarget(device, action, value) {
        switch (action) {
            case "turn_on":
            case "turn_off":
            case "open_cover":
            case "close_cover":
                return alreadyIn(device, action);
            case "set_temperature":
                return Boolean(device.climate) &&
                    device.climate.target !== null &&
                    Math.abs(device.climate.target - value) < 0.05;
            case "set_brightness":
                if (value === 0) return device.state === "off";

                return device.state === "on" && Boolean(device.light) &&
                    Math.abs(device.light.brightness - value) <= 1;
            case "set_position":
                return Boolean(device.cover) &&
                    device.cover.position !== null &&
                    Math.abs(device.cover.position - value) <= 1;
            case "set_mode":
                return device.state === value;
            default:
                return true;
        }
    }

    async function runAction(device, action, value) {
        const [result] = await runCommand([device], action, value);
        return result;
    }

    async function runCommand(targets, action, value) {
        const ids = targets.map(device => device.entity_id);
        const roomAtStart = roomToken;
        const roomId = room.id;
        const done = ACTIONS[action].done;
        const results = new Map();

        const finish = () => ids.map(id => results.get(id) || "cancelled");
        const resolve = (id, result, type, text) => {
            results.set(id, result);
            setStatus(id, type, text);
        };

        const failDevice = (id, message) => resolve(
            id, "failed", "failed", `Failed: ${message} (${nowLabel()})`
        );

        ids.forEach(id => setStatus(id, "pending", "Sending command..."));

        let response;

        try {
            response = await sendCommand(roomId, ids, action, value);
        } catch (error) {
            if (roomAtStart !== roomToken) return finish();

            ids.forEach(id => failDevice(
                id,
                error.results?.[id]?.error || error.message
            ));

            loadDevices({ silent: true, statesOnly: true });
            return finish();
        }

        if (roomAtStart !== roomToken) return finish();

        ids.forEach(id => {
            const result = response.results?.[id];

            if (result && !result.ok) failDevice(id, result.error);
        });

        const sent = ids.filter(id => !results.has(id));

        if (action === "stop_cover") {
            sent.forEach(id => resolve(
                id, "success", "success", `${done} · ${nowLabel()}`
            ));
            loadDevices({ silent: true, statesOnly: true });
            return finish();
        }

        sent.forEach(id => setStatus(
            id, "pending", "Waiting for the device to confirm..."
        ));

        for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
            await sleep(VERIFY_DELAY_MS);

            if (roomAtStart !== roomToken) return finish();

            let list;

            try {
                list = await fetchDevices(roomId);
            } catch (error) {
                continue;
            }

            if (roomAtStart !== roomToken) return finish();

            devices = mergeDevices(list);

            ids.filter(id => !results.has(id)).forEach(id => {
                const updated = list.find(item => item.entity_id === id);

                if (!updated) {
                    resolve(id, "failed", "failed",
                        "Failed: the device was not found.");
                } else if (updated.availability === "unavailable") {
                    resolve(id, "failed", "failed",
                        "Failed: the device became unavailable.");
                } else if (reachedTarget(updated, action, value)) {
                    drafts.delete(id);
                    resolve(id, "success", "success",
                        `${done} · ${nowLabel()}`);
                }
            });

            if (results.size === ids.length) return finish();

            render();
        }

        if (roomAtStart !== roomToken) return finish();

        ids.filter(id => !results.has(id)).forEach(id => resolve(
            id, "unconfirmed", "unconfirmed",
            "Command sent, but the device has not confirmed the change yet."
        ));

        return finish();
    }

    document.addEventListener("room:selected", event => {
        const detail = event.detail || {};

        if (!detail.id) return;

        closeConfirm(false);
        roomToken++;
        resetRoomState();

        room = { id: detail.id, name: detail.name || "this room" };

        loadDevices();
    });

    document.addEventListener("room:cleared", () => {
        closeConfirm(false);
        roomToken++;
        loadToken++;
        resetRoomState();

        room = null;
        showMessage("Select a room to see its devices.");
    });

    function autoRefresh() {
        if (!room || document.hidden || anyPending() || !dialog.hidden ||
            devices.length === 0) {
            return;
        }

        loadDevices({ silent: true, statesOnly: true });
    }

    setInterval(autoRefresh, REFRESH_MS);

    document.addEventListener("visibilitychange", autoRefresh);

    if (refreshButton) {
        refreshButton.addEventListener("click", () => {
            loadDevices({ silent: devices.length > 0 });
        });
    }
});
