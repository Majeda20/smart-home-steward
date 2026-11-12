
<?php
require __DIR__ . '/../session.php';

requireLogin('login.php');
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Dashboard | Smart Home Steward</title>

    <link rel="stylesheet" href="css/pages.css">
    <link rel="stylesheet" href="css/nav-bar.css">
    <link rel="stylesheet" href="css/user-panel.css">
    <link rel="stylesheet" href="css/device-control.css">
</head>

<body>

    <?php include __DIR__ . '/nav-bar.php'; ?>

    <main class="content user-panel">

        <header class="user-panel-header">
            <div>
                <h1>Room Overview</h1>
                <p>
                    Search and select a room to view its live status
                    and connected devices.
                </p>
            </div>

            <div class="room-search-container">
                <input
                    type="search"
                    id="room-search"
                    class="room-search-input"
                    aria-label="Search rooms"
                    autocomplete="off"
                    placeholder="Search rooms"
                >

                <button type="button"
                        id="room-search-clear"
                        class="room-search-clear"
                        aria-label="Clear search"
                        hidden>
                    <img src="../images/icons/close.svg" alt="">
                </button>
            </div>
        </header>

        <section class="dashboard-section room-selection-section"
                 aria-label="Rooms">

            <div class="room-selection-grid" id="room-selection-grid"></div>

            <div class="room-see-more">
                <button type="button"
                        id="room-see-more"
                        class="room-see-more-button"
                        hidden>
                    See more
                </button>

                <button type="button"
                        id="room-see-less"
                        class="room-see-more-button"
                        hidden>
                    See less
                </button>
            </div>

            <p id="room-load-status"
               class="room-search-empty is-loading"
               role="status">
                Loading rooms...
            </p>

            <p id="room-search-empty"
               class="room-search-empty"
               hidden>
                No matching rooms found.
            </p>

        </section>

        <div class="room-empty-state"
             id="room-empty-state"
             role="status">

            <div class="room-empty-icon">
                <img src="../images/icons/question.svg" alt="">
            </div>

            <h2>No room selected</h2>

            <p>
                Select a room above to view its sensor information
                and device controls.
            </p>
        </div>

        <div id="selected-room-content" hidden>

            <div class="room-dashboard-header">
                <div class="room-dashboard-header-left">
                    <div class="room-dashboard-icon" aria-hidden="true">
                        <img src="../images/icons/room.svg" alt="">
                    </div>
                    <div>
                        <h2 id="room-detail-title">Room</h2>
                        <p>
                            Room &bull;
                            <span id="room-sensor-count">
                                0 of 0 sensors available
                            </span>
                        </p>
                    </div>
                </div>

                <div class="room-updated-time"></div>
            </div>

            <div class="section-header">
                <div>
                    <h2>Sensor Data</h2>
                    <p>Live readings from the sensors in this room.</p>
                </div>
            </div>

            <div class="room-climate-cards" id="room-sensor-cards"></div>

            <div class="room-see-more sensor-see-more">
                <button type="button"
                        id="sensor-see-more"
                        class="room-see-more-button"
                        hidden>
                    See more
                </button>

                <button type="button"
                        id="sensor-see-less"
                        class="room-see-more-button"
                        hidden>
                    See less
                </button>
            </div>

            <p class="room-sensors-message" id="room-sensors-message" hidden></p>

            <div class="temp-chart-section" hidden>
                <div class="temp-chart-header">
                    <div>
                        <div class="temp-chart-title">
                            Temperature over time
                        </div>
                        <div class="temp-chart-subtitle">
                            Average of available sensors
                        </div>
                    </div>

                    <div class="temp-chart-delta">
                        ↑ +0.6 °C in the last hour
                    </div>
                </div>

                <canvas id="temp-chart"
                        class="temp-chart-canvas"
                        aria-label="Legacy temperature chart"
                        role="img"></canvas>

                <div class="temp-chart-labels">
                    <span>60 min ago</span>
                    <span>30 min ago</span>
                    <span>Now</span>
                </div>
            </div>

            <section class="dashboard-section"
                     aria-labelledby="device-control-title">

                <div class="section-header">
                    <div>
                        <h2 id="device-control-title">Device Control</h2>
                        <p>Control the connected devices in this room.</p>
                    </div>

                    <button type="button"
                            id="device-refresh"
                            class="dc-btn dc-btn-secondary">
                        Refresh
                    </button>
                </div>

                <p id="device-summary"
                   class="dc-summary"
                   hidden></p>

                <div id="device-filters"
                     class="dc-filters"
                     role="group"
                     aria-label="Filter devices by type"
                     hidden></div>

                <div class="dc-panel"
                     id="device-control-panel"
                     aria-busy="false">
                    <div class="dc-message">
                        <p>Select a room to see its devices.</p>
                    </div>
                </div>

            </section>

        </div>

    </main>

    <div id="csm-backdrop"
         class="csm-backdrop"
         hidden></div>

    <div id="climate-sensor-modal"
         class="csm-modal"
         hidden
         role="dialog"
         aria-modal="true"
         aria-labelledby="csm-title">

        <div class="csm-header">
            <h2 id="csm-title">Room - Temperature</h2>
            <button id="csm-close"
                    class="csm-close"
                    aria-label="Close">
                ✕
            </button>
        </div>

        <p class="csm-subtitle">
            Average of available sensors in the room
        </p>

        <div class="csm-avg-block">
            <span id="csm-avg"
                  class="csm-avg-value">--</span>

            <span id="csm-count"
                  class="csm-count">0 sensors</span>
        </div>

        <div class="sensor-chart-section">
            <div class="sensor-chart-header">
                <div class="sensor-chart-periods"
                     role="group"
                     aria-label="Chart time period">
                    <button type="button"
                            class="sensor-chart-period"
                            data-period="1h"
                            aria-pressed="false">1h</button>
                    <button type="button"
                            class="sensor-chart-period"
                            data-period="24h"
                            aria-pressed="true">24h</button>
                    <button type="button"
                            class="sensor-chart-period"
                            data-period="7d"
                            aria-pressed="false">7d</button>
                    <button type="button"
                            class="sensor-chart-period"
                            data-period="30d"
                            aria-pressed="false">30d</button>
                </div>
            </div>

            <canvas id="csm-chart"
                    class="sensor-chart-canvas"
                    aria-label="Sensor history chart"
                    role="img"></canvas>

            <p class="sensor-chart-status"
               id="csm-chart-status">
                Historical data not loaded.
            </p>
        </div>

        <div class="csm-divider"></div>

        <div id="csm-sensor-list"
             class="csm-sensor-list"></div>

    </div>

    <div id="dc-group-backdrop"
         class="dc-group-backdrop"
         hidden></div>

    <div id="dc-group"
         class="dc-group-modal"
         hidden
         role="dialog"
         aria-modal="true"
         aria-labelledby="dc-group-title"
         aria-describedby="dc-group-subtitle">

        <div class="dc-group-header">
            <div>
                <h2 id="dc-group-title">Devices</h2>
                <p id="dc-group-subtitle"
                   class="dc-group-subtitle"></p>
            </div>

            <button type="button"
                    id="dc-group-close"
                    class="csm-close"
                    aria-label="Close">
                ✕
            </button>
        </div>

        <div id="dc-group-bulk"
             class="dc-group-bulk"
             hidden></div>

        <div id="dc-group-list"
             class="dc-group-list"></div>
    </div>

    <div id="dc-backdrop"
         class="dc-backdrop"
         hidden></div>

    <div id="dc-confirm"
         class="dc-confirm"
         hidden
         role="alertdialog"
         aria-modal="true"
         aria-labelledby="dc-confirm-title"
         aria-describedby="dc-confirm-text">

        <h2 id="dc-confirm-title">Confirm action</h2>

        <p id="dc-confirm-text"></p>

        <div class="dc-confirm-actions">
            <button type="button"
                    id="dc-confirm-cancel"
                    class="dc-btn dc-btn-secondary">
                Cancel
            </button>

            <button type="button"
                    id="dc-confirm-ok"
                    class="dc-btn dc-btn-primary">
                Confirm
            </button>
        </div>
    </div>

    <script src="js/script.js"></script>
    <script src="js/room-overview.js"></script>
    <script src="js/device-control.js"></script>

</body>
</html>
