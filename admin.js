const DESKTOP_USERS_PER_PAGE = 5;
const MOBILE_USERS_PER_PAGE = 5;

const userSearchInput = document.getElementById("user-search");
const userRoleFilter = document.getElementById("user-role-filter");
const userResults = document.getElementById("user-results");
const userTableScroll = document.getElementById("user-table-scroll");
const userCardList = document.getElementById("user-card-list");

const userLists = [];

function createUserList(container, perPage) {
    const actions = container.parentElement.querySelector(".see-more-actions");

    return {
        container,
        perPage,
        items: Array.from(container.querySelectorAll(".user-item")),
        actions,
        moreButton: actions.querySelector('[data-action="more"]'),
        lessButton: actions.querySelector('[data-action="less"]'),
    };
}

if (userTableScroll) {
    userLists.push(createUserList(userTableScroll, DESKTOP_USERS_PER_PAGE));
    userLists.push(createUserList(userCardList, MOBILE_USERS_PER_PAGE));
}

let loadedPages = 1;


function matchesFilters(item) {
    const query = userSearchInput.value.trim().toLowerCase();
    const role = userRoleFilter.value;

    const matchesQuery = query === ""
        || item.dataset.name.includes(query)
        || item.dataset.email.includes(query);

    const matchesRole = role === "" || item.dataset.role === role;

    return matchesQuery && matchesRole;
}


function sizeUserList(list) {
    const container = list.container;
    const scrollTop = container.scrollTop;

    container.style.maxHeight = "";

    const shownItems = list.items.filter((item) => !item.hidden);

    if (shownItems.length > list.perPage && container.offsetHeight > 0) {
        const lastVisible = shownItems[list.perPage - 1];
        const height = lastVisible.getBoundingClientRect().bottom - container.getBoundingClientRect().top;

        container.style.maxHeight = `${Math.ceil(height)}px`;
        container.scrollTop = scrollTop;
    }

    container.classList.toggle("is-scrollable", container.scrollHeight > container.clientHeight);
}


function sizeUserLists() {
    userLists.forEach(sizeUserList);
}


function updateUserResults() {
    const visibleList = userLists.find((list) => list.container.offsetParent !== null) || userLists[0];

    if (!visibleList || visibleList.matchCount === 0) {
        userResults.textContent = "No users match your search.";
    } else {
        userResults.textContent = `Showing ${visibleList.shownCount} of ${visibleList.matchCount} users`;
    }
}


function applyUserFilters() {
    userLists.forEach((list) => {
        const loadedCount = loadedPages * list.perPage;
        let listMatches = 0;

        list.items.forEach((item) => {
            const matches = matchesFilters(item);

            item.hidden = !matches || listMatches >= loadedCount;

            if (matches) {
                listMatches++;
            }
        });

        list.moreButton.hidden = listMatches <= loadedCount;
        list.lessButton.hidden = loadedPages === 1;
        list.actions.hidden = list.moreButton.hidden && list.lessButton.hidden;

        list.matchCount = listMatches;
        list.shownCount = Math.min(listMatches, loadedCount);
    });

    updateUserResults();
    sizeUserLists();
}


function removeUserFromLists(userId) {
    userLists.forEach((list) => {
        list.items = list.items.filter((item) => {
            if (item.dataset.userId === String(userId)) {
                item.remove();
                return false;
            }

            return true;
        });
    });

    applyUserFilters();
}


function showMoreUsers(list) {
    loadedPages++;
    applyUserFilters();

    if (list.moreButton.hidden) {
        list.lessButton.focus({ preventScroll: true });
    }
}


function showLessUsers(list) {
    loadedPages = 1;
    applyUserFilters();

    list.container.scrollTop = 0;
    list.moreButton.focus();
}


if (userSearchInput) {

    userSearchInput.addEventListener("input", () => {
        loadedPages = 1;
        applyUserFilters();
    });

    userRoleFilter.addEventListener("change", () => {
        loadedPages = 1;
        applyUserFilters();
    });

    userLists.forEach((list) => {
        list.moreButton.addEventListener("click", () => {
            showMoreUsers(list);
        });

        list.lessButton.addEventListener("click", () => {
            showLessUsers(list);
        });
    });

    window.addEventListener("resize", () => {
        updateUserResults();
        sizeUserLists();
    });

    applyUserFilters();

}
