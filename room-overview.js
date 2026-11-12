
document.addEventListener("DOMContentLoaded", () => {
    const roomGrid = document.getElementById("room-selection-grid");
    const loadStatus = document.getElementById("room-load-status");
    const searchInput = document.getElementById("room-search");
    const clearButton = document.getElementById("room-search-clear");
    const seeMoreButton = document.getElementById("room-see-more");
    const seeLessButton = document.getElementById("room-see-less");
    const emptyMessage = document.getElementById("room-search-empty");
    const emptyState = document.getElementById("room-empty-state");
    const roomContent = document.getElementById("selected-room-content");
    const roomDetailTitle = document.getElementById("room-detail-title");

    if (!roomGrid || !loadStatus || !searchInput ||
        !emptyMessage || !emptyState || !roomContent) {
        return;
    }

    const ROOMS_PER_PAGE = 6;

    const READINGS_REFRESH_MS = 10000;

    const ROOMS_TIMEOUT_MS = 10000;

    const SENSORS_TIMEOUT_MS = 8000;

    const CHART_TIMEOUT_MS = 15000;

    let roomCards = [];
    let visibleLimit = ROOMS_PER_PAGE;

    let selectedRoomId = null;
    let roomData = null;
    let sensorsError = null;

    const SENSOR_LOOKS = {
        temperature: { icon: "temperature", color: "#e5484d", rgb: "229, 72, 77", decimals: 1 },
        humidity: { icon: "humidity", color: "#3478c0", rgb: "52, 120, 192", decimals: 0 },
        carbon_dioxide: { icon: "co2", color: "#43866b", rgb: "67, 134, 107", decimals: 0 },
        sound_pressure: { icon: "noise", color: "#7c5cbf", rgb: "124, 92, 191" },
        illuminance: { icon: "light", color: "#c99400", rgb: "201, 148, 0" },
        irradiance: { icon: "light", color: "#c99400", rgb: "201, 148, 0" },
        power: { icon: "power", color: "#0e8a8a", rgb: "14, 138, 138" }
    };

    const DEFAULT_LOOK = { icon: "sensor", color: "#6b7689", rgb: "107, 118, 137" };

    function findMetric(key) {
        return roomData
            ? roomData.metrics.find(metric => metric.key === key) || null
            : null;
    }

    function metricConfig(key) {
        const metric = findMetric(key);
        const look = (metric && SENSOR_LOOKS[metric.type]) || DEFAULT_LOOK;

        let decimals = look.decimals;

        if (decimals === undefined) {
            const values = roomData
                ? roomData.sensors.map(sensor => sensor.readings[key])
                : [];

            decimals = values.some(value =>
                typeof value === "number" && !Number.isInteger(value)
            ) ? 1 : 0;
        }

        return {
            label: metric ? metric.label : "",
            unit: metric ? metric.unit : "",
            sum: metric ? metric.sum : false,
            icon: look.icon,
            color: look.color,
            rgb: look.rgb,
            decimals
        };
    }

    function formatValue(metric, value) {
        return value === null
            ? "--"
            : value.toFixed(metricConfig(metric).decimals);
    }

    function sensorTotal(key) {
        return roomData
            ? roomData.sensors.filter(sensor => key in sensor.readings).length
            : 0;
    }

    function sensorCountText(config, count, total = count) {
        const sensors = total > count
            ? `${count} of ${total} sensors`
            : `${count} sensor${count !== 1 ? "s" : ""}`;

        if (count <= 1) return sensors;

        return config.sum ? `Total of ${sensors}` : `Average of ${sensors}`;
    }

    async function fetchJson(url, timeoutMs) {
        let response;
        let data;

        try {
            response = await fetch(url, {
                credentials: "same-origin",
                signal: AbortSignal.timeout(timeoutMs)
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
            throw new Error(data.error || "Request failed.");
        }

        return data;
    }

    const pad = number => String(number).padStart(2, "0");

    const formatTime = time =>
        `${pad(time.getHours())}:${pad(time.getMinutes())}`;

    const formatWeekday = time =>
        time.toLocaleDateString("en-GB", { weekday: "short" });

    const formatDay = time =>
        time.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    const CHART_PERIODS = {
        "1h": {
            label: "Last hour",
            refreshMs: 10000,
            labelEvery: 3,
            axisLabel: formatTime,
            tooltipLabel: formatTime
        },
        "24h": {
            label: "Last 24 hours",
            refreshMs: 30000,
            labelEvery: 4,
            axisLabel: formatTime,
            tooltipLabel: formatTime
        },
        "7d": {
            label: "Last 7 days",
            refreshMs: 120000,
            labelEvery: 4,
            axisLabel: formatWeekday,
            tooltipLabel: time =>
                `${formatWeekday(time)} ${formatTime(time)}`
        },
        "30d": {
            label: "Last 30 days",
            refreshMs: 300000,
            labelEvery: 5,
            axisLabel: formatDay,
            tooltipLabel: formatDay
        }
    };

    let chartPeriod = "24h";

    const chartCache = new Map();

    let chart = { state: "loading", points: [], sensors: 0 };
    let chartRequest = 0;
    let chartLoadingKey = null;
    let chartLoadingId = 0;

    async function loadChart(metric) {
        const roomId = selectedRoomId;
        const period = chartPeriod;
        const key = `${roomId}|${metric}|${period}`;
        const cached = chartCache.get(key);

        if (cached && Date.now() - cached.loadedAt < CHART_PERIODS[period].refreshMs) {
            ++chartRequest;

            if (chart === cached) return;

            chart = cached;
            drawSensorChart(metric);
            return;
        }

        if (chartLoadingKey === key) {
            chartRequest = chartLoadingId;

            if (chart.state !== "loading") {
                chart = cached || { state: "loading", points: [], sensors: 0 };
                drawSensorChart(metric);
            }

            return;
        }

        const requestId = ++chartRequest;
        chartLoadingKey = key;
        chartLoadingId = requestId;

        chart = cached || { state: "loading", points: [], sensors: 0 };
        drawSensorChart(metric);

        try {
            const params = new URLSearchParams({
                room: roomId,
                metric,
                period
            });

            const data = await fetchJson(
                `api/sensor-history.php?${params}`,
                CHART_TIMEOUT_MS
            );

            const loaded = {
                state: "ready",
                loadedAt: Date.now(),
                sensors: data.sensors,
                points: data.points.map(point => ({
                    time: new Date(point.time),
                    value: point.value
                }))
            };

            chartCache.set(key, loaded);

            if (requestId !== chartRequest) return;

            chart = loaded;
        } catch (error) {
            console.error(error);

            if (requestId !== chartRequest) return;

            chart = {
                state: "error",
                message: error.timedOut ? error.message : "Could not load history.",
                points: [],
                sensors: 0
            };
        } finally {
            if (chartLoadingKey === key) chartLoadingKey = null;
        }

        if (modalMetric === metric) drawSensorChart(metric);
    }

    const CHART_LEFT = 45;
    const CHART_RIGHT = 12;

    function chartStatusText(metric, period) {
        if (chart.state === "loading") return "Loading history…";
        if (chart.state === "error") return chart.message;

        if (chart.sensors === 0) {
            return "No sensors in this room measure this.";
        }

        if (chart.points.every(point => point.value === null)) {
            return "No history for this period.";
        }

        return `${sensorCountText(metricConfig(metric), chart.sensors)} - ` +
            period.label.toLowerCase();
    }

    function drawSensorChart(metric, hoverIndex = null) {
        const canvas = document.getElementById("csm-chart");
        const status = document.getElementById("csm-chart-status");

        if (!canvas) return;

        const config = metricConfig(metric);
        const period = CHART_PERIODS[chartPeriod];
        const points = chart.points;

        if (status) {
            status.textContent = chartStatusText(metric, period);
            status.classList.toggle("is-error", chart.state === "error");
            status.classList.toggle("is-loading", chart.state === "loading");
            status.setAttribute("role", chart.state === "error" ? "alert" : "status");
        }

        const rect = canvas.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);

        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;

        ctx.clearRect(0, 0, width, height);

        const values = points
            .map(point => point.value)
            .filter(value => value !== null);

        if (values.length === 0) return;

        const left = CHART_LEFT;
        const right = CHART_RIGHT;
        const top = 15;
        const bottom = 30;

        const plotW = width - left - right;
        const plotH = height - top - bottom;

        if (plotW <= 0 || plotH <= 0) return;

        const lastIndex = Math.max(points.length - 1, 1);

        const minimum = Math.min(...values);
        const maximum = Math.max(...values);

        const padding = Math.max(
            (maximum - minimum) * 0.2,
            Math.abs(maximum) * 0.03,
            1
        );

        const min = minimum >= 0
            ? Math.max(minimum - padding, 0)
            : minimum - padding;
        const max = maximum + padding;

        const toX = index =>
            left + (index / lastIndex) * plotW;

        const toY = value =>
            top + (1 - (value - min) / (max - min)) * plotH;

        ctx.font = "10px Arial, sans-serif";

        for (let i = 0; i <= 4; i++) {
            const fraction = i / 4;
            const y = top + fraction * plotH;
            const value = max - fraction * (max - min);

            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + plotW, y);

            ctx.strokeStyle = "#e8eaed";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = "#6b7689";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";

            ctx.fillText(
                value.toFixed(config.decimals),
                left - 7,
                y
            );
        }

        ctx.fillStyle = "#6b7689";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(config.unit, 3, 0);

        ctx.textBaseline = "top";

        points.forEach((point, index) => {
            if (index % period.labelEvery !== 0) return;

            const label = period.axisLabel(point.time);

            const x = toX(index);

            ctx.fillStyle = "#6b7689";

            if (index === 0) {
                ctx.textAlign = "left";
            } else if (index === lastIndex) {
                ctx.textAlign = "right";
            } else {
                ctx.textAlign = "center";
            }

            ctx.fillText(
                label,
                x,
                height - bottom + 9
            );
        });

        const segments = [];
        let segment = [];

        points.forEach((point, index) => {
            if (point.value === null) {
                if (segment.length) segments.push(segment);
                segment = [];
            } else {
                segment.push(index);
            }
        });

        if (segment.length) segments.push(segment);

        const gradient = ctx.createLinearGradient(
            0,
            top,
            0,
            top + plotH
        );

        gradient.addColorStop(
            0,
            `rgba(${config.rgb}, 0.15)`
        );

        gradient.addColorStop(
            1,
            `rgba(${config.rgb}, 0)`
        );

        segments.forEach(indexes => {
            const first = indexes[0];
            const last = indexes[indexes.length - 1];

            ctx.beginPath();
            ctx.moveTo(toX(first), top + plotH);

            indexes.forEach(index => {
                ctx.lineTo(toX(index), toY(points[index].value));
            });

            ctx.lineTo(toX(last), top + plotH);
            ctx.closePath();

            ctx.fillStyle = gradient;
            ctx.fill();
        });

        ctx.strokeStyle = config.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        segments.forEach(indexes => {
            ctx.beginPath();

            indexes.forEach((index, i) => {
                const x = toX(index);
                const y = toY(points[index].value);

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();
        });

        points.forEach((point, index) => {
            if (point.value === null) return;

            ctx.beginPath();

            ctx.arc(
                toX(index),
                toY(point.value),
                1.7,
                0,
                Math.PI * 2
            );

            ctx.fillStyle = config.color;
            ctx.fill();
        });

        if (hoverIndex !== null && points[hoverIndex]) {
            const point = points[hoverIndex];
            const hasValue = point.value !== null;
            const x = toX(hoverIndex);
            const y = hasValue
                ? toY(point.value)
                : top + plotH / 2;

            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + plotH);
            ctx.strokeStyle = "#c5cad3";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);

            if (hasValue) {
                ctx.beginPath();
                ctx.arc(x, y, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = "#ffffff";
                ctx.fill();
                ctx.strokeStyle = config.color;
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            const valueText = hasValue
                ? `${formatValue(metric, point.value)} ${config.unit}`
                : "No data";

            const label =
                `${period.tooltipLabel(point.time)}  ${valueText}`;

            ctx.font = "600 11px Arial, sans-serif";

            const boxW = ctx.measureText(label).width + 16;
            const boxH = 22;

            const boxX = Math.min(
                Math.max(x - boxW / 2, 0),
                width - boxW
            );

            const boxY = y - boxH - 10 >= 0
                ? y - boxH - 10
                : y + 10;

            ctx.fillStyle = "#1f2b47";
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, 4);
            ctx.fill();

            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2);
        }
    }

    const backdrop = document.getElementById("csm-backdrop");
    const modal = document.getElementById("climate-sensor-modal");
    const modalTitle = document.getElementById("csm-title");
    const modalList = document.getElementById("csm-sensor-list");
    const modalClose = document.getElementById("csm-close");
    const periodButtons = document.querySelectorAll(".sensor-chart-period");

    let modalMetric = null;

    function renderModalReadings(metric) {
        const config = metricConfig(metric);
        const summary = findMetric(metric) || { value: null, count: 0 };

        const avgEl = document.getElementById("csm-avg");

        if (avgEl) {
            avgEl.replaceChildren();

            avgEl.append(
                document.createTextNode(
                    `${formatValue(metric, summary.value)} `
                )
            );

            const unit = document.createElement("small");
            unit.textContent = config.unit;
            avgEl.appendChild(unit);
        }

        const countEl = document.getElementById("csm-count");

        if (countEl) {
            countEl.textContent = sensorCountText(
                config,
                summary.count,
                sensorTotal(metric)
            );
        }

        const subtitle = modal.querySelector(".csm-subtitle");

        if (subtitle) {
            subtitle.textContent = config.sum
                ? "Total of available sensors in the room"
                : "Average of available sensors in the room";
        }

        modalList.replaceChildren();

        const sensors = roomData
            ? roomData.sensors.filter(sensor => metric in sensor.readings)
            : [];

        if (sensors.length === 0) {
            const empty = document.createElement("p");
            empty.className = "csm-sensor-empty";
            empty.textContent = roomData
                ? `No ${config.label.toLowerCase()} sensors in this room.`
                : "Loading sensors…";

            modalList.appendChild(empty);
            return;
        }

        sensors.forEach(sensor => {
            const value = sensor.readings[metric];
            const unavailable = value === null;

            const row = document.createElement("div");
            row.className = "csm-sensor-row";

            if (unavailable) {
                row.classList.add("csm-sensor-unavailable");
            }

            const info = document.createElement("div");
            info.className = "csm-sensor-info";

            const name = document.createElement("span");
            name.className = "csm-sensor-name";
            name.textContent = sensor.name;

            const sensorStatus = document.createElement("span");

            sensorStatus.className =
                "csm-sensor-status " +
                (unavailable ? "csm-offline" : "csm-online");

            sensorStatus.textContent = unavailable
                ? "Unavailable"
                : "Active";

            info.append(name, sensorStatus);

            const valueElement = document.createElement("div");
            valueElement.className = "csm-sensor-value";

            if (unavailable) {
                valueElement.textContent = "--";
            } else {
                valueElement.append(
                    document.createTextNode(
                        `${formatValue(metric, value)} `
                    )
                );

                const unitElement = document.createElement("span");
                unitElement.className = "csm-sensor-unit";
                unitElement.textContent = config.unit;

                valueElement.appendChild(unitElement);
            }

            row.append(info, valueElement);
            modalList.appendChild(row);
        });
    }

    function openModal(metric) {
        if (!modal || !backdrop || !modalTitle || !modalList) {
            return;
        }

        const roomName = roomDetailTitle
            ? roomDetailTitle.textContent
            : "Room";

        modalTitle.textContent =
            `${roomName} - ${metricConfig(metric).label}`;

        renderModalReadings(metric);

        backdrop.hidden = false;
        modal.hidden = false;
        document.body.style.overflow = "hidden";

        modalMetric = metric;
        requestAnimationFrame(() => loadChart(metric));

        if (modalClose) modalClose.focus();
    }

    function closeModal() {
        if (!modal || !backdrop) return;

        modalMetric = null;
        chart = { state: "loading", points: [], sensors: 0 };
        backdrop.hidden = true;
        modal.hidden = true;
        document.body.style.overflow = "";
    }

    periodButtons.forEach(button => {
        button.addEventListener("click", () => {
            chartPeriod = button.dataset.period;

            periodButtons.forEach(other => {
                other.setAttribute(
                    "aria-pressed",
                    String(other === button)
                );
            });

            if (modalMetric) loadChart(modalMetric);
        });
    });

    const modalChart = document.getElementById("csm-chart");

    if (modalChart) {
        modalChart.addEventListener("pointermove", event => {
            if (!modalMetric || chart.points.length < 2) return;

            const rect = modalChart.getBoundingClientRect();
            const plotW = rect.width - CHART_LEFT - CHART_RIGHT;
            const fraction = (event.clientX - rect.left - CHART_LEFT) / plotW;
            const index = Math.round(
                Math.min(Math.max(fraction, 0), 1) *
                (chart.points.length - 1)
            );

            drawSensorChart(modalMetric, index);
        });

        modalChart.addEventListener("pointerleave", () => {
            if (modalMetric) drawSensorChart(modalMetric);
        });
    }

    if (modalClose) {
        modalClose.addEventListener("click", closeModal);
    }

    if (backdrop) {
        backdrop.addEventListener("click", closeModal);
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && modal && !modal.hidden) {
            closeModal();
        }
    });

    const SENSORS_PER_PAGE = 3;

    const sensorCards = document.getElementById("room-sensor-cards");
    const sensorsMessage = document.getElementById("room-sensors-message");
    const sensorSeeMore = document.getElementById("sensor-see-more");
    const sensorSeeLess = document.getElementById("sensor-see-less");

    let sensorLimit = SENSORS_PER_PAGE;

    function updateVisibleSensors() {
        const cards = Array.from(sensorCards.children);

        cards.forEach((card, index) => {
            card.hidden = index >= sensorLimit;
        });

        sensorSeeMore.hidden = sensorLimit >= cards.length;
        sensorSeeLess.hidden = sensorLimit <= SENSORS_PER_PAGE;
    }

    sensorSeeMore.addEventListener("click", () => {
        sensorLimit += SENSORS_PER_PAGE;
        updateVisibleSensors();
    });

    sensorSeeLess.addEventListener("click", () => {
        sensorLimit = SENSORS_PER_PAGE;
        updateVisibleSensors();

        const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        sensorCards.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "nearest"
        });
    });

    function createSensorCard(key) {
        const config = metricConfig(key);

        const card = document.createElement("div");
        card.className = "climate-card";
        card.dataset.metric = key;
        card.setAttribute("role", "button");
        card.tabIndex = 0;

        const top = document.createElement("div");
        top.className = "climate-card-top";

        const title = document.createElement("span");
        title.className = "climate-card-title";
        title.textContent = config.label;

        const icon = document.createElement("img");
        icon.className = "climate-card-icon";
        icon.src = `../images/icons/${config.icon}.svg`;
        icon.alt = "";

        top.append(title, icon);

        const value = document.createElement("div");
        value.className = "climate-card-value";

        const number = document.createElement("span");
        number.className = "climate-card-number";

        const unit = document.createElement("span");
        unit.className = "climate-unit";
        unit.textContent = config.unit;

        value.append(number, document.createTextNode(" "), unit);

        const meta = document.createElement("div");
        meta.className = "climate-card-meta";

        const link = document.createElement("div");
        link.className = "climate-card-link";
        link.textContent = "Individual readings ";

        const arrow = document.createElement("span");
        arrow.textContent = "→";
        link.appendChild(arrow);

        card.append(top, value, meta, link);

        card.addEventListener("click", () => {
            openModal(key);
        });

        card.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openModal(key);
            }
        });

        return card;
    }

    function renderSensorCards() {
        const metrics = roomData ? roomData.metrics : [];
        const keys = metrics.map(metric => metric.key).join("|");

        if (sensorCards.dataset.keys !== keys) {
            sensorCards.dataset.keys = keys;
            sensorCards.replaceChildren(
                ...metrics.map(metric => createSensorCard(metric.key))
            );
        }

        metrics.forEach(metric => {
            const card = sensorCards.querySelector(
                `[data-metric="${CSS.escape(metric.key)}"]`
            );

            card.querySelector(".climate-card-number").textContent =
                formatValue(metric.key, metric.value);

            card.querySelector(".climate-card-meta").textContent =
                `${sensorCountText(
                    metricConfig(metric.key),
                    metric.count,
                    sensorTotal(metric.key)
                )} ●`;
        });

        updateVisibleSensors();

        sensorsMessage.classList.toggle("is-error", sensorsError !== null);
        sensorsMessage.classList.toggle("is-loading", sensorsError === null && roomData === null);
        sensorsMessage.setAttribute("role", sensorsError !== null ? "alert" : "status");

        if (sensorsError !== null) {
            sensorsMessage.hidden = false;
            sensorsMessage.textContent = sensorsError;
            return;
        }

        sensorsMessage.hidden = roomData !== null && metrics.length > 0;
        sensorsMessage.textContent = roomData
            ? "No sensors in this room."
            : "Loading sensors…";
    }

    const updatedTime = document.querySelector(".room-updated-time");

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function renderRoomData() {
        renderSensorCards();

        if (!roomData) {
            setText("room-sensor-count", "Loading sensors…");
            if (updatedTime) updatedTime.textContent = "";
            return;
        }

        const total = roomData.sensors.length;
        const available = roomData.sensors.filter(sensor =>
            Object.values(sensor.readings).every(value => value !== null)
        ).length;

        setText(
            "room-sensor-count",
            total === 0
                ? "No sensors"
                : `${available} of ${total} sensors available`
        );

        if (updatedTime) {
            updatedTime.textContent = roomData.updated
                ? `● Updated ${new Date(roomData.updated).toLocaleTimeString("en-GB")}`
                : "● No sensor data";
        }
    }

    async function loadRoomData(roomId) {
        try {
            const data = await fetchJson(
                `api/room-sensors.php?room=${encodeURIComponent(roomId)}`,
                SENSORS_TIMEOUT_MS
            );

            if (roomId !== selectedRoomId) return;

            roomData = data;
            sensorsError = null;
        } catch (error) {
            console.error(error);

            if (roomId !== selectedRoomId) return;

            sensorsError = error.timedOut
                ? error.message
                : "Could not load sensors. Please try again later.";

            renderSensorCards();

            if (!roomData) {
                setText("room-sensor-count", "Could not load sensors");
            }

            return;
        }

        renderRoomData();

        if (modalMetric) renderModalReadings(modalMetric);
    }

    function selectRoom(roomId) {
        selectedRoomId = roomId;
        roomData = null;
        sensorsError = null;
        sensorLimit = SENSORS_PER_PAGE;

        renderRoomData();
        loadRoomData(roomId);
    }

    function refreshRoom() {
        if (!selectedRoomId || document.hidden) return;

        loadRoomData(selectedRoomId);

        if (modalMetric && chart.state !== "error") loadChart(modalMetric);
    }

    setInterval(refreshRoom, READINGS_REFRESH_MS);

    document.addEventListener("visibilitychange", refreshRoom);

    function setHint(card, isSelected) {
        const hint = card.querySelector(".room-card-hint");

        if (hint) {
            hint.textContent = isSelected
                ? "Selected"
                : "View details";
        }
    }

    function createRoomCard(room) {
        const card = document.createElement("button");

        card.type = "button";
        card.className = "room-selection-card";
        card.dataset.room = room.id;
        card.setAttribute("aria-pressed", "false");

        const icon = document.createElement("img");
        icon.className = "room-card-icon";
        icon.src = "../images/icons/room.svg";
        icon.alt = "";

        const name = document.createElement("span");
        name.className = "room-card-name";
        name.textContent = room.name;

        const hint = document.createElement("span");
        hint.className = "room-card-hint";
        hint.textContent = "View details";

        card.append(icon, name, hint);

        card.addEventListener("click", () => {
            handleCardClick(card);
        });

        return card;
    }

    function handleCardClick(card) {
        if (card.classList.contains("is-selected")) {
            card.classList.remove("is-selected");
            card.setAttribute("aria-pressed", "false");
            setHint(card, false);

            card.classList.remove("just-unselected");
            void card.offsetWidth;
            card.classList.add("just-unselected");

            card.addEventListener(
                "mouseleave",
                () => card.classList.remove("just-unselected"),
                { once: true }
            );

            selectedRoomId = null;
            emptyState.hidden = false;
            roomContent.hidden = true;

            document.dispatchEvent(new CustomEvent("room:cleared"));

            return;
        }

        roomCards.forEach(otherCard => {
            const isSelected = otherCard === card;

            otherCard.classList.toggle(
                "is-selected",
                isSelected
            );

            otherCard.setAttribute(
                "aria-pressed",
                String(isSelected)
            );

            otherCard.classList.remove("just-unselected");
            setHint(otherCard, isSelected);
        });

        if (roomDetailTitle) {
            const name = card.querySelector(".room-card-name");

            roomDetailTitle.textContent = name
                ? name.textContent
                : "Room";
        }

        selectRoom(card.dataset.room);

        document.dispatchEvent(new CustomEvent("room:selected", {
            detail: {
                id: card.dataset.room,
                name: roomDetailTitle
                    ? roomDetailTitle.textContent
                    : "Room"
            }
        }));

        emptyState.hidden = true;
        roomContent.hidden = false;

        const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;

        roomContent.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "start"
        });
    }

    async function loadRooms() {
        try {
            const data = await fetchJson("api/rooms.php", ROOMS_TIMEOUT_MS);

            if (!Array.isArray(data.rooms)) {
                throw new Error("Unexpected rooms response.");
            }

            roomCards = data.rooms.map(createRoomCard);
            roomGrid.replaceChildren(...roomCards);

            loadStatus.classList.remove("is-loading");

            if (roomCards.length === 0) {
                if (data.hidden > 0) {
                    const link = document.createElement("a");
                    link.href = "preferences.php";
                    link.textContent = "Show rooms in Preferences";

                    loadStatus.replaceChildren("All your rooms are hidden. ", link);
                } else {
                    loadStatus.textContent = "No rooms found.";
                }

                return;
            }

            loadStatus.hidden = true;
            updateVisibleRooms();
        } catch (error) {
            console.error(error);

            loadStatus.hidden = false;
            loadStatus.classList.remove("is-loading");
            loadStatus.classList.add("is-error");
            loadStatus.setAttribute("role", "alert");
            loadStatus.textContent = error.timedOut
                ? error.message
                : "Could not load rooms. Please try again later.";
        }
    }

    function updateVisibleRooms() {
        const query = searchInput.value.trim().toLowerCase();

        let visibleCount = 0;

        roomCards.forEach((card, index) => {
            const roomName = card
                .querySelector(".room-card-name")
                .textContent
                .toLowerCase();

            const isVisible = query
                ? roomName.includes(query)
                : index < visibleLimit;

            card.hidden = !isVisible;

            if (isVisible) visibleCount++;
        });

        emptyMessage.hidden = !query || visibleCount !== 0;

        if (seeMoreButton) {
            seeMoreButton.hidden =
                query !== "" ||
                visibleLimit >= roomCards.length;
        }

        if (seeLessButton) {
            seeLessButton.hidden =
                query !== "" ||
                visibleLimit <= ROOMS_PER_PAGE;
        }
    }

    if (seeMoreButton) {
        seeMoreButton.addEventListener("click", () => {
            visibleLimit += ROOMS_PER_PAGE;
            updateVisibleRooms();
        });
    }

    if (seeLessButton) {
        seeLessButton.addEventListener("click", () => {
            visibleLimit = ROOMS_PER_PAGE;
            updateVisibleRooms();

            const reduceMotion = window.matchMedia(
                "(prefers-reduced-motion: reduce)"
            ).matches;

            roomGrid.scrollIntoView({
                behavior: reduceMotion ? "auto" : "smooth",
                block: "nearest"
            });
        });
    }

    if (clearButton) {
        clearButton.addEventListener("click", () => {
            searchInput.value = "";
            searchInput.dispatchEvent(new Event("input"));
            searchInput.focus();
        });
    }

    searchInput.addEventListener("input", () => {
        if (clearButton) {
            clearButton.hidden = searchInput.value === "";
        }

        updateVisibleRooms();
    });

    window.addEventListener("resize", () => {
        if (modalMetric) {
            requestAnimationFrame(() => drawSensorChart(modalMetric));
        }
    });

    loadRooms();
});
