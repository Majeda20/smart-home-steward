<?php
require __DIR__ . '/../session.php';

requireLogin('login.php');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Situations | Smart Home Steward</title>
  <link rel="stylesheet" href="css/pages.css">
  <link rel="stylesheet" href="css/nav-bar.css">
  <link rel="stylesheet" href="css/smart-situations.css">
</head>
<body>

  <?php include __DIR__ . '/nav-bar.php'; ?>

  <main class="content ss-content">
    <header class="ss-header">
      <h1>Smart Situations</h1>
      <p>Situations detected in your home, why they were detected and what you can do. Press Accept to choose what should happen.</p>
    </header>

    <p class="ss-toast" id="ss-toast" role="status" hidden></p>

    <div class="ss-filters">
      <div class="ss-field ss-field-search">
        <label for="ss-search">Search</label>
        <div class="ss-search-wrap">
          <input type="search" id="ss-search" placeholder="Search by situation or room" autocomplete="off" maxlength="100">
          <button type="button" class="search-clear" aria-label="Clear search" hidden>
            <img src="../images/icons/close.svg" alt="">
          </button>
        </div>
      </div>

      <div class="ss-field">
        <label for="ss-room">Room</label>
        <select id="ss-room">
          <option value="">All rooms</option>
        </select>
      </div>

      <div class="ss-field">
        <span class="ss-label" id="ss-tabs-label">Status</span>
        <div class="ss-tabs" role="group" aria-labelledby="ss-tabs-label" id="ss-tabs">
          <button type="button" data-filter="waiting">Open <span class="ss-tab-count"></span></button>
          <button type="button" data-filter="done">Resolved <span class="ss-tab-count"></span></button>
          <button type="button" data-filter="dismissed">Dismissed <span class="ss-tab-count"></span></button>
          <button type="button" data-filter="all">All</button>
        </div>
      </div>
    </div>

    <section class="ss-table" aria-label="Detected situations">
      <div class="ss-row ss-head" aria-hidden="true">
        <span>Situation</span>
        <span>Room</span>
        <span>Detected</span>
        <span>Actions</span>
        <span>Status</span>
        <span></span>
      </div>
      <div id="ss-list"></div>
      <p class="ss-empty" id="ss-empty" hidden>No situations match your filters.</p>
    </section>

    <p class="ss-note">By default the list opens on "Open". Every decision is saved in <a href="history.php">History</a>.</p>
  </main>

  <div class="ss-backdrop" id="ss-backdrop" hidden></div>
  <div class="ss-modal" id="ss-modal" role="dialog" aria-modal="true" aria-labelledby="ss-modal-title" aria-describedby="ss-modal-sub" hidden>
    <div class="ss-modal-body">
      <div class="ss-modal-head">
        <div>
          <h2 id="ss-modal-title"></h2>
          <p class="ss-modal-sub" id="ss-modal-sub"></p>
        </div>
        <button type="button" class="ss-close" id="ss-modal-close" aria-label="Close">
          <img src="../images/icons/close.svg" alt="">
        </button>
      </div>

      <div class="ss-modal-bar">
        <span class="ss-modal-bar-title">Actions to run</span>
        <label class="ss-select-all">
          <input type="checkbox" id="ss-select-all">
          <span>Select all</span>
        </label>
      </div>

      <ul class="ss-options" id="ss-options"></ul>
    </div>

    <div class="ss-modal-foot">
      <span class="ss-selected-count" id="ss-selected-count"></span>
      <div class="ss-modal-buttons">
        <button type="button" class="ss-btn ss-btn-grey" id="ss-modal-cancel">Cancel</button>
        <button type="button" class="ss-btn ss-btn-red" id="ss-modal-run"></button>
      </div>
    </div>
  </div>

  <script src="js/script.js"></script>
  <script src="js/smart-situations.js"></script>
</body>
</html>
