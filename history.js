const HISTORY_PAGE_SIZE = 10;
const HISTORY_SEARCH_DELAY = 300;

const HISTORY_TYPE_LOOKS = {
    device: { label: "Device Control", className: "history-badge-device" },
    situations: { label: "Smart Situation", className: "history-badge-situation" },
    users: { label: "User Account", className: "history-badge-users" },
    other: { label: "Other", className: "history-badge-other" },
};

const HISTORY_STATUS_LABELS = {
    succeeded: "Success",
    failed: "Failed",
    pending: "Pending",
};

const historySearchInput = document.getElementById("history-search");
const historyTypeFilter = document.getElementById("history-type");
const historyPeriodFilter = document.getElementById("history-period");
const historyStatus = document.getElementById("history-status");
const historyScroll = document.getElementById("history-scroll");
const historyList = document.getElementById("history-list");
const historyActions = document.getElementById("history-actions");
const historyMoreButton = historyActions.querySelector('[data-action="more"]');
const historyLessButton = historyActions.querySelector('[data-action="less"]');

let historyEvents = [];
let historyHasMore = false;
let historyTotal = 0;
let historyRequest = null;
let historySearchTimer = null;


function setHistoryStatus(message, isError = false) {
    historyStatus.hidden = message === "";
    historyStatus.textContent = message;
    historyStatus.classList.toggle("admin-message-error", isError);
}


async function fetchHistory(offset) {
    if (historyRequest) {
        historyRequest.abort();
    }

    historyRequest = new AbortController();

    const params = new URLSearchParams({
        q: historySearchInput.value.trim(),
        type: historyTypeFilter.value,
        period: historyPeriodFilter.value,
        offset: String(offset),
    });

    const response = await fetch(`${historyScroll.dataset.endpoint}?${params}`, { signal: historyRequest.signal });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Could not load activity history.");
    }

    return data;
}


function formatHistoryTime(isoTime) {
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(isoTime));
}


function findMatch(lowerText, lowerQuery, from, wordStart) {
    let index = lowerText.indexOf(lowerQuery, from);

    while (wordStart && index > 0 && /[\p{L}\p{N}]/u.test(lowerText[index - 1])) {
        index = lowerText.indexOf(lowerQuery, index + 1);
    }

    return index;
}


function appendHighlighted(parent, text, query, wordStart = false) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let start = 0;
    let index = lowerQuery ? findMatch(lowerText, lowerQuery, 0, wordStart) : -1;

    while (index !== -1) {
        parent.append(text.slice(start, index));

        const mark = document.createElement("mark");
        mark.className = "search-highlight";
        mark.textContent = text.slice(index, index + query.length);
        parent.append(mark);

        start = index + query.length;
        index = findMatch(lowerText, lowerQuery, start, wordStart);
    }

    parent.append(text.slice(start));
}


function formatQuantity(quantity) {
    if (quantity.unit !== "celsius") {
        return String(quantity.value);
    }

    if (document.documentElement.dataset.temperatureUnit === "fahrenheit") {
        return `${Math.round((quantity.value * 9 / 5 + 32) * 10) / 10} °F`;
    }

    return `${quantity.value} °C`;
}


function createDescription(event) {
    const description = document.createElement("span");
    const parts = event.parts || [{ text: event.description || "" }];
    const query = historySearchInput.value.trim();

    parts.forEach(part => {
        if (!part.kind) {
            appendHighlighted(description, part.text, query, true);
            return;
        }

        const keyword = document.createElement("strong");
        keyword.className = `history-keyword history-keyword-${part.kind}`;
        appendHighlighted(keyword, part.quantity ? formatQuantity(part.quantity) : part.text, query);
        description.append(keyword);

        if (part.note) {
            description.append(part.note);
        }
    });

    return description;
}


function createHistoryItem(event) {
    const item = document.createElement("li");
    item.className = "history-item";
    item.setAttribute("role", "row");

    const content = document.createElement("div");
    content.className = "history-item-content";
    content.setAttribute("role", "cell");

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.append(createDescription(event));

    const status = document.createElement("span");
    status.className = "history-status";

    if (event.status === "failed" || event.status === "pending") {
        status.classList.add(`history-status-${event.status}`);
    }

    status.textContent = HISTORY_STATUS_LABELS[event.status] || "Success";

    const statusCell = document.createElement("div");
    statusCell.setAttribute("role", "cell");
    statusCell.append(status);

    content.append(title);

    const typeCell = document.createElement("div");
    typeCell.setAttribute("role", "cell");

    const typeLook = HISTORY_TYPE_LOOKS[event.type] || HISTORY_TYPE_LOOKS.other;
    const badge = document.createElement("span");
    badge.className = `history-badge ${typeLook.className}`;
    badge.textContent = typeLook.label;

    typeCell.append(badge);

    const timeCell = document.createElement("div");
    timeCell.setAttribute("role", "cell");

    const time = document.createElement("time");
    time.className = "history-item-time";
    time.dateTime = event.time;
    time.textContent = formatHistoryTime(event.time);

    timeCell.append(time);

    item.append(content, typeCell, statusCell, timeCell);

    return item;
}


function sizeHistoryList() {
    const scrollTop = historyScroll.scrollTop;
    const items = historyList.children;

    historyScroll.style.maxHeight = "";

    if (items.length > HISTORY_PAGE_SIZE && historyScroll.offsetHeight > 0) {
        const lastVisible = items[HISTORY_PAGE_SIZE - 1];
        const height = lastVisible.getBoundingClientRect().bottom - historyScroll.getBoundingClientRect().top;

        historyScroll.style.maxHeight = `${Math.ceil(height)}px`;
        historyScroll.scrollTop = scrollTop;
    }

    historyScroll.classList.toggle("is-scrollable", historyScroll.scrollHeight > historyScroll.clientHeight);
}


function renderHistory() {
    historyList.replaceChildren(...historyEvents.map(createHistoryItem));

    if (historyEvents.length === 0) {
        const filtered = historySearchInput.value.trim() !== "" || historyTypeFilter.value !== "";
        setHistoryStatus(filtered ? "No activity matches your search." : "No activity in this period.");
    } else {
        const noun = historyTotal === 1 ? "activity" : "activities";
        setHistoryStatus(`Showing ${historyEvents.length} of ${historyTotal} ${noun}`);
    }

    historyMoreButton.hidden = !historyHasMore;
    historyLessButton.hidden = historyEvents.length <= HISTORY_PAGE_SIZE;
    historyActions.hidden = historyMoreButton.hidden && historyLessButton.hidden;

    sizeHistoryList();
}


function setHistoryLoading(isLoading) {
    historyScroll.classList.toggle("is-loading", isLoading);
    historyScroll.setAttribute("aria-busy", String(isLoading));
}


async function loadHistory() {
    if (historyList.children.length > 0) {
        setHistoryLoading(true);
    } else {
        setHistoryStatus("Loading activity...");
    }

    try {
        const data = await fetchHistory(0);

        historyEvents = data.events;
        historyHasMore = data.hasMore;
        historyTotal = data.total;
        renderHistory();
        historyScroll.scrollTop = 0;
        setHistoryLoading(false);
    } catch (error) {
        if (error.name !== "AbortError") {
            historyEvents = [];
            historyHasMore = false;
            historyTotal = 0;
            renderHistory();
            setHistoryStatus(error.message || "Could not load activity history.", true);
            setHistoryLoading(false);
        }
    }
}


async function loadMoreHistory() {
    const firstNewIndex = historyEvents.length;

    historyMoreButton.disabled = true;
    historyMoreButton.textContent = "Loading...";

    try {
        const data = await fetchHistory(firstNewIndex);

        historyEvents = historyEvents.concat(data.events);
        historyHasMore = data.hasMore;
        historyTotal = data.total;
        renderHistory();

        if (historyMoreButton.hidden) {
            historyLessButton.focus({ preventScroll: true });
        }
    } catch (error) {
        if (error.name !== "AbortError") {
            setHistoryStatus(error.message || "Could not load more activity.", true);
        }
    } finally {
        historyMoreButton.disabled = false;
        historyMoreButton.textContent = "See more...";
    }
}


function showLessHistory() {
    historyEvents = historyEvents.slice(0, HISTORY_PAGE_SIZE);
    historyHasMore = true;
    renderHistory();

    historyScroll.scrollTop = 0;
    historyMoreButton.focus();
}


historySearchInput.addEventListener("input", () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(loadHistory, HISTORY_SEARCH_DELAY);
});

historyTypeFilter.addEventListener("change", loadHistory);
historyPeriodFilter.addEventListener("change", loadHistory);
historyMoreButton.addEventListener("click", loadMoreHistory);
historyLessButton.addEventListener("click", showLessHistory);
window.addEventListener("resize", sizeHistoryList);

loadHistory();