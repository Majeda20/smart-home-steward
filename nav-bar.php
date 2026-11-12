<?php
require_once __DIR__ . '/../user-preferences.php';

$currentPage = basename($_SERVER['PHP_SELF']);
$username = htmlspecialchars($_SESSION['username'] ?? 'User', ENT_QUOTES, 'UTF-8');
$navPreferences = currentPreferences();
?>

<span id="user-preferences" data-temperature-unit="<?php echo $navPreferences['temperature_unit']; ?>" hidden></span>

<button class="menu-toggle" aria-label="Open menu">
  <span></span>
  <span></span>
  <span></span>
</button>

<div class="account" id="account">
  <button type="button" class="account-toggle" aria-label="Account menu" aria-expanded="false" aria-controls="account-menu">
    <img class="account-icon" src="../images/icons/account.svg" alt="">
    <span class="account-greeting">Hello, <?php echo $username; ?></span>
  </button>

  <div class="account-menu" id="account-menu">
    <p class="account-menu-greeting">Hello, <?php echo $username; ?></p>

    <a href="preferences.php" class="account-menu-link<?php echo $currentPage === 'preferences.php' ? ' active' : ''; ?>"<?php echo $currentPage === 'preferences.php' ? ' aria-current="page"' : ''; ?>>
      <img src="../images/icons/settings.svg" alt="">
      Preferences
    </a>

    <form method="post" action="logout.php">
      <button type="submit" class="logout">
        <img src="../images/icons/logout.svg" alt="Logout icon">
        Logout
      </button>
    </form>
  </div>
</div>

<aside class="sidebar" id="sidebar">
  <div class="brand">
    <img class="brand-icon" src="../images/icons/home.svg" alt="Home icon">

    <p class="brand-name">Smart Home Steward</p>
    <p class="brand-tagline">Control Your World...</p>
  </div>

  <nav class="nav">
    <ul>
      <?php if (isAdmin()): ?>
      <li><a href="admin.php" class="<?php echo $currentPage === 'admin.php' ? 'active' : ''; ?>">Admin Panel</a></li>
      <li><a href="configure-smart-situations.php" class="<?php echo $currentPage === 'configure-smart-situations.php' ? 'active' : ''; ?>">Configure Smart Situations</a></li>
      <?php endif; ?>
      <li><a href="index.php" class="<?php echo $currentPage === 'index.php' ? 'active' : ''; ?>">Dashboard</a></li>
      <li><a href="smart-situations.php" class="<?php echo $currentPage === 'smart-situations.php' ? 'active' : ''; ?>">Smart Situations<span class="nav-badge" data-situations-badge role="img" hidden><img src="../images/icons/bell.svg" alt="" width="13" height="13"></span></a></li>
      
      <li><a href="history.php" class="<?php echo $currentPage === 'history.php' ? 'active' : ''; ?>">History</a></li>
    </ul>
  </nav>
</aside>
