<?php
require __DIR__ . '/../session.php';

requireAdmin('index.php', 'login.php');

$users = [];
$usersError = null;

require __DIR__ . '/../connection.php';

if (!isset($pdo)) {
    $usersError = 'User accounts are unavailable right now. Please try again later.';
} else {
    try {
        $users = $pdo->query(
            'SELECT o.id, o.username, o.email, ut.type AS role
             FROM occupant o
             JOIN user_type ut ON ut.id = o.user_type_id
             ORDER BY LOWER(o.username)'
        )->fetchAll();
    } catch (PDOException $e) {
        error_log('Loading users failed: ' . $e->getMessage());
        $usersError = 'Could not load user accounts. Please try again.';
    }
}

$currentUserId = (int) $_SESSION['user_id'];

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function userDataAttributes(array $user): string
{
    return ' data-user-id="' . (int) $user['id'] . '"'
        . ' data-name="' . e(strtolower($user['username'])) . '"'
        . ' data-email="' . e(strtolower($user['email'])) . '"'
        . ' data-role="' . e(strtolower($user['role'])) . '"';
}

function userActionButton(string $action, array $user, ?string $lockReason): string
{
    $verb = $action === 'delete' ? 'Delete' : 'Edit';
    $label = $lockReason ?? "$verb {$user['username']}";

    return '<button type="button" class="btn-' . $action . ($lockReason !== null ? ' is-locked' : '') . '"'
        . ' data-user-id="' . (int) $user['id'] . '"'
        . ' data-username="' . e($user['username']) . '"'
        . ' data-email="' . e($user['email']) . '"'
        . ' data-role="' . e(strtolower($user['role'])) . '"'
        . ($lockReason !== null
            ? ' aria-disabled="true" data-lock-reason="' . e($lockReason) . '"'
            : ' aria-haspopup="dialog"')
        . ' aria-label="' . e($label) . '" title="' . e($lockReason ?? $verb) . '">'
        . '<img src="../images/icons/' . $action . '.svg" alt="">'
        . '</button>';
}

function userActions(array $user, int $currentUserId): string
{
    $deleteLock = (int) $user['id'] === $currentUserId
        ? 'You cannot delete your own account.'
        : null;

    return '<span class="user-actions">'
        . userActionButton('edit', $user, null)
        . userActionButton('delete', $user, $deleteLock)
        . '</span>';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Panel - Smart Home Steward</title>
  <link rel="stylesheet" href="css/pages.css">
  <link rel="stylesheet" href="css/nav-bar.css">
  <link rel="stylesheet" href="css/history.css">
  <link rel="stylesheet" href="css/admin-panel.css">
</head>
<body>

  <?php include __DIR__ . '/nav-bar.php'; ?>

  <main class="content admin-content">

    <h1 class="admin-main-title">User Management</h1>

    <div class="admin-card">
      <h2 class="admin-card-subtitle">User Accounts</h2>

      <p class="admin-message admin-message-success" id="user-edit-status" role="status" hidden></p>

      <?php if ($usersError !== null): ?>
        <p class="admin-message admin-message-error" role="alert"><?= e($usersError) ?></p>
      <?php elseif (!$users): ?>
        <p class="admin-message">No user accounts found.</p>
      <?php else: ?>
        <div class="user-filters">
          <div class="filter-field filter-search">
            <label for="user-search">Search</label>
            <div class="search-input-wrap">
              <input type="search" id="user-search" placeholder="Search by name or email" autocomplete="off">
              <button type="button" class="search-clear" aria-label="Clear search" hidden>
                <img src="../images/icons/close.svg" alt="">
              </button>
            </div>
          </div>
          <div class="filter-field">
            <label for="user-role-filter">Role</label>
            <select id="user-role-filter">
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
          </div>
        </div>

        <p class="user-results" id="user-results" aria-live="polite"></p>

        <div class="desktop-only">
          <div class="user-table-head">
            <table class="admin-user-table" aria-hidden="true">
              <colgroup>
                <col class="col-name"><col class="col-email"><col class="col-role"><col class="col-actions">
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th></th>
                </tr>
              </thead>
            </table>
          </div>
          <div class="user-scroll" id="user-table-scroll" tabindex="0" role="region" aria-label="User accounts">
            <table class="admin-user-table">
              <colgroup>
                <col class="col-name"><col class="col-email"><col class="col-role"><col class="col-actions">
              </colgroup>
              <thead class="visually-hidden">
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                <?php foreach ($users as $user): ?>
                  <tr class="user-item"<?= userDataAttributes($user) ?>>
                    <td class="user-name"><?= e($user['username']) ?></td>
                    <td class="user-email"><?= e($user['email']) ?></td>
                    <td><span class="role-badge role-<?= e(strtolower($user['role'])) ?>"><?= e(ucfirst($user['role'])) ?></span></td>
                    <td><?= userActions($user, $currentUserId) ?></td>
                  </tr>
                <?php endforeach; ?>
              </tbody>
            </table>
          </div>
          <div class="see-more-actions">
            <button type="button" class="btn-see-more" data-action="more" aria-controls="user-table-scroll" hidden>See more...</button>
            <button type="button" class="btn-see-more" data-action="less" aria-controls="user-table-scroll" hidden>See less</button>
          </div>
        </div>

        <div class="mobile-only">
          <div class="user-card-list user-scroll" id="user-card-list" tabindex="0" role="region" aria-label="User accounts">
            <?php foreach ($users as $user): ?>
                <div class="user-detail-card user-item"<?= userDataAttributes($user) ?>>
                  <div class="detail-row-header">
                    <span class="detail-name user-name"><?= e($user['username']) ?></span>
                    <span class="role-badge role-<?= e(strtolower($user['role'])) ?>"><?= e(ucfirst($user['role'])) ?></span>
                  </div>
                  <div class="detail-row-email">
                    <span class="detail-email-label">Email:</span>
                    <span class="detail-email-val user-email"><?= e($user['email']) ?></span>
                    <?= userActions($user, $currentUserId) ?>
                  </div>
                </div>
            <?php endforeach; ?>
          </div>
          <div class="see-more-actions">
            <button type="button" class="btn-see-more" data-action="more" aria-controls="user-card-list" hidden>See more...</button>
            <button type="button" class="btn-see-more" data-action="less" aria-controls="user-card-list" hidden>See less</button>
          </div>
        </div>
      <?php endif; ?>
    </div>

    <div class="history-page">

      <h2 class="admin-main-title admin-history-title">History</h2>
      <p class="history-description">
        View what all users have done: device controls, smart situation actions and account changes.
      </p>

      <section class="history-card" aria-labelledby="history-activity-title">
        <h3 class="history-card-title" id="history-activity-title">Recent Activities</h3>

        <div class="history-filters">
          <div class="history-filter history-filter-search">
            <label for="history-search">Search</label>
            <div class="search-input-wrap">
              <input type="search" id="history-search" placeholder="Search by user or device" autocomplete="off" maxlength="100">
              <button type="button" class="search-clear" aria-label="Clear search" hidden>
                <img src="../images/icons/close.svg" alt="">
              </button>
            </div>
          </div>
          <div class="history-filter">
            <label for="history-type">Type</label>
            <select id="history-type">
              <option value="">All types</option>
              <option value="device">Device control</option>
              <option value="situations">Smart situations</option>
              <option value="users">User accounts</option>
            </select>
          </div>
          <div class="history-filter">
            <label for="history-period">Period</label>
            <select id="history-period">
              <option value="today">Today</option>
              <option value="7d" selected>Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>

        <p class="user-results" id="history-status" aria-live="polite">Loading activity...</p>

        <div class="history-table" role="table" aria-label="Activity history">
          <div class="history-table-header" role="row">
            <span role="columnheader">Activity</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Date &amp; Time</span>
          </div>

          <div class="history-table-body user-scroll" id="history-scroll" data-endpoint="api/admin-history.php" tabindex="0" role="rowgroup" aria-label="Recent activities">
            <ul class="history-list" id="history-list" role="none"></ul>
          </div>
        </div>

        <div class="see-more-actions" id="history-actions" hidden>
          <button type="button" class="btn-see-more" data-action="more" aria-controls="history-scroll" hidden>See more...</button>
          <button type="button" class="btn-see-more" data-action="less" aria-controls="history-scroll" hidden>See less</button>
        </div>
      </section>

    </div>

  </main>

  <div class="admin-backdrop" id="user-edit-backdrop" hidden></div>

  <div class="admin-modal"
       id="user-edit"
       role="dialog"
       aria-modal="true"
       aria-labelledby="user-edit-title"
       data-current-user-id="<?= $currentUserId ?>"
       hidden>

    <h2 id="user-edit-title">Edit user</h2>

    <p class="admin-message admin-message-error" id="user-edit-error" role="alert" hidden></p>

    <form id="user-edit-form" novalidate>
      <input type="hidden" id="user-edit-id">

      <div class="modal-field">
        <label for="user-edit-username">Username</label>
        <input type="text" id="user-edit-username" autocomplete="off" maxlength="50" aria-describedby="user-edit-username-error">
        <p class="field-error" id="user-edit-username-error"></p>
      </div>

      <div class="modal-field">
        <label for="user-edit-email">Email</label>
        <input type="email" id="user-edit-email" autocomplete="off" maxlength="255" aria-describedby="user-edit-email-error">
        <p class="field-error" id="user-edit-email-error"></p>
      </div>

      <div class="modal-field">
        <label for="user-edit-role">Role</label>
        <select id="user-edit-role" aria-describedby="user-edit-role-hint user-edit-role-error">
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <p class="field-hint" id="user-edit-role-hint"></p>
        <p class="field-error" id="user-edit-role-error"></p>
      </div>

      <div class="modal-actions">
        <button type="button" class="admin-btn admin-btn-secondary" id="user-edit-cancel">Cancel</button>
        <button type="submit" class="admin-btn admin-btn-primary" id="user-edit-save">Save changes</button>
      </div>
    </form>
  </div>

  <div class="admin-modal admin-confirm"
       id="user-delete"
       role="alertdialog"
       aria-modal="true"
       aria-labelledby="user-delete-title"
       aria-describedby="user-delete-text"
       hidden>

    <h2 id="user-delete-title">Delete user?</h2>

    <p id="user-delete-text"></p>

    <p class="admin-message admin-message-error" id="user-delete-error" role="alert" hidden></p>

    <div class="modal-actions">
      <button type="button" class="admin-btn admin-btn-secondary" id="user-delete-cancel">Cancel</button>
      <button type="button" class="admin-btn admin-btn-danger" id="user-delete-confirm">Delete user</button>
    </div>
  </div>

  <script src="js/script.js"></script>
  <script src="js/admin.js"></script>
  <script src="js/history.js"></script>
  <script src="js/admin-user-actions.js"></script>
</body>
</html>