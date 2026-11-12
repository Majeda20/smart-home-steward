<?php
require __DIR__ . '/../session.php';

requireAdmin('index.php', 'login.php');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configure Smart Situations - Smart Home Steward</title>
  <link rel="stylesheet" href="css/pages.css">
  <link rel="stylesheet" href="css/nav-bar.css">
  <link rel="stylesheet" href="css/admin-panel.css">
  <link rel="stylesheet" href="css/configure-situations.css">
</head>
<body>

  <?php include __DIR__ . '/nav-bar.php'; ?>

  <main class="content admin-content">

    <h1 class="admin-main-title">Configure Smart Situations</h1>

    <p class="admin-message admin-message-success" id="situation-status" role="status" hidden></p>

    <section class="admin-card cs-form-card" aria-labelledby="situation-form-title">
      <h2 class="admin-card-subtitle cs-title" id="situation-form-title">Create smart situation</h2>
      <p class="cs-intro">Users will see this situation when all conditions are met, and can accept or dismiss the suggested action.</p>

      <form id="situation-form" novalidate>
        <input type="hidden" id="situation-id">

        <div class="modal-field cs-field">
          <label for="situation-name">Situation name</label>
          <input type="text" id="situation-name" maxlength="80" autocomplete="off"
                 placeholder="e.g. Heating on with an open window" aria-describedby="situation-name-error">
          <p class="field-error" id="situation-name-error"></p>
        </div>

        <fieldset class="cs-group">
          <div class="cs-group-head">
            <legend class="cs-legend">Apply to rooms <span class="cs-muted" id="room-count"></span></legend>
            <div class="cs-link-actions">
              <button type="button" class="cs-link cs-link-accent" id="rooms-select-all">Select all</button>
              <button type="button" class="cs-link" id="rooms-clear">Clear</button>
            </div>
          </div>
          <div class="cs-room-grid" id="room-grid"></div>
          <p class="cs-hint">Only rooms that have the sensors and devices used in the conditions and actions can be selected.</p>
          <p class="field-error" id="rooms-error"></p>
        </fieldset>

        <div class="cs-group">
          <h3 class="cs-legend">When <span class="cs-muted">- all conditions are true</span></h3>
          <ul class="cs-rows" id="condition-list"></ul>
          <button type="button" class="cs-add" id="add-condition"><span aria-hidden="true">+</span> Add condition</button>
          <p class="field-error" id="conditions-error"></p>
        </div>

        <div class="cs-group">
          <h3 class="cs-legend">Then <span class="cs-muted">- run these actions, in order</span></h3>
          <ol class="cs-rows" id="action-list"></ol>
          <p class="cs-hint" id="actions-none" hidden>No actions - users will only be able to acknowledge or dismiss this situation.</p>
          <div class="cs-add-row">
            <button type="button" class="cs-add" id="add-action"><span aria-hidden="true">+</span> Add action</button>
            <span class="cs-muted cs-small">Turn on · Turn off · Set value</span>
          </div>
          <p class="field-error" id="actions-error"></p>
        </div>

        <div class="cs-form-footer">
          <button type="button" class="admin-btn admin-btn-secondary" id="situation-clear">Clear</button>
          <button type="submit" class="admin-btn admin-btn-primary" id="situation-submit">Create</button>
        </div>
      </form>
    </section>

    <section class="admin-card cs-list-card" aria-labelledby="situations-title">
      <div class="cs-list-head">
        <h2 class="admin-card-subtitle cs-title" id="situations-title">Created situations</h2>
        <span class="cs-muted cs-small" id="enabled-count"></span>
      </div>

      <div class="user-filters">
        <div class="filter-field filter-search">
          <label for="situation-search">Search</label>
          <div class="search-input-wrap">
            <input type="search" id="situation-search" placeholder="Search by name, device or room" autocomplete="off" maxlength="100">
            <button type="button" class="search-clear" aria-label="Clear search" hidden>
              <img src="../images/icons/close.svg" alt="">
            </button>
          </div>
        </div>
        <div class="filter-field">
          <label for="situation-state-filter">Status</label>
          <select id="situation-state-filter">
            <option value="">All</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>

      <p class="user-results" id="situation-results" aria-live="polite"></p>

      <div class="cs-card-grid" id="situation-grid"></div>
    </section>

  </main>

  <div class="admin-backdrop" id="situation-delete-backdrop" hidden></div>
  <div class="admin-modal admin-confirm" id="situation-delete" role="alertdialog" aria-modal="true"
       aria-labelledby="situation-delete-title" aria-describedby="situation-delete-text" hidden>
    <h2 id="situation-delete-title">Delete situation?</h2>
    <p id="situation-delete-text"></p>
    <div class="modal-actions">
      <button type="button" class="admin-btn admin-btn-secondary" id="situation-delete-cancel">Cancel</button>
      <button type="button" class="admin-btn admin-btn-danger" id="situation-delete-confirm">Delete situation</button>
    </div>
  </div>

  <script src="js/script.js"></script>
  <script src="js/configure-situations.js"></script>
</body>
</html>
