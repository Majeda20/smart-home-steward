# Smart Home Steward - Group 5

A PHP web app for monitoring and controlling the MDU smart room through **Home Assistant**. Built for the DVA231 course project.

Users can see each room's sensors and devices, switch devices on and off, and react to **smart situations**. A smart situation is a rule that watches sensor values and can trigger device actions automatically. Admins manage users, define the situation rules, and browse the full activity history.

## Setup

### 1. Requirements

- XAMPP (or another Apache + PHP 8 setup) with the `pdo_pgsql` and `curl` extensions enabled in `php.ini`
- Access to the PostgreSQL database (Supabase)
- A Home Assistant URL and a long-lived access token

### 2. Clone into the web root

```bash
cd C:/xampp/htdocs
git clone <repo-url> dva231-project
cd dva231-project
git checkout dev
```

### 3. Create the config file

The real config lives **outside the repo** so credentials are never committed. Copy `config.example.php` and fill in your values:

```
C:/xampp/secrets/dva231/config.php
```

```php
<?php
return [
    'host'     => 'aws-1-eu-central-1.pooler.supabase.com',
    'port'     => 5432,
    'dbname'   => 'postgres',
    'user'     => 'postgres.YOUR_PROJECT_REF',
    'password' => 'YOUR_DB_PASSWORD',

    'hass_url'   => 'https://hass.mdu-smartroom.se:81NN',
    'hass_token' => 'YOUR_HASS_API_TOKEN',
];
```

To keep the file somewhere else, set the `DVA231_CONFIG` environment variable to its path.

### 4. Run

Start Apache in XAMPP and open:

```
http://localhost/dva231-project/pages/login.php
```

Register a new account; new accounts get the `user` role. To create an admin, change the user's `user_type_id` in the database, or have an existing admin change the role in the Admin Panel.

### 5. Start the smart situation checker

Smart situations are only detected while the checker is running. On Windows, double-click `checker/start-checker.bat`, or run:

```bash
php checker/check-situations.php          # runs continuously (every 5 s)
php checker/check-situations.php --once   # single check, then exit
```

## Features

**For every logged-in user**

- **Dashboard** (`index.php`): an overview of every room with live sensor values (temperature, humidity, CO₂, noise, light level, power, solar irradiance), device controls (lights, switches, fans, climate/radiators, covers), door/window and presence state, and sensor history charts.
- **Smart Situations** (`smart-situations.php`): a list of situations that have fired in the last 30 days. Users can *acknowledge*, *dismiss*, *restore* or *run* (resolve) one. The nav bar shows a bell badge while situations are open.
- **Preferences** (`preferences.php`): set the temperature unit (°C / °F) and hide rooms from the dashboard, plus edit or delete your own account.
- **History** (`history.php`): shows the user's own activity history (device commands, account changes and smart situation actions). *(In progress.)*

**For admins**

- **Admin Panel** (`admin.php`): create, edit and delete users and change their roles. It also has a searchable, filterable activity history (device commands, account changes, situation events).
- **Configure Smart Situations** (`configure-smart-situations.php`): build rules from conditions (state is/is not, number above/below/equals, time between) and actions (turn on, turn off, set value). Rules can be enabled or disabled.

**Background checker**

- `checker/check-situations.php` is a CLI script. Every 5 seconds it evaluates all enabled rules against Home Assistant, opens or closes situations, and runs their actions.

## Tech stack

| Layer      | Technology                                                    |
|------------|---------------------------------------------------------------|
| Backend    | PHP 8 (PDO, cURL, sessions)                                   |
| Frontend   | HTML, CSS, vanilla JavaScript (fetch → JSON APIs)             |
| Database   | PostgreSQL (hosted on Supabase)                               |
| Smart home | Home Assistant REST API (`/api/states`, `/api/template`, services) |
| Local dev  | XAMPP (Apache + PHP)                                          |

## Project structure

```
.
├── config.example.php        # Template for DB + Home Assistant credentials
├── connection.php            # Creates the PDO connection ($pdo)
├── session.php               # Session setup + isLoggedIn / requireLogin / isAdmin helpers
├── user-preferences.php      # Temperature unit + hidden rooms preferences
├── checker/
│   ├── check-situations.php  # CLI loop that evaluates smart situation rules
│   ├── situation-engine.php  # Rule evaluation + action execution
│   ├── start-checker.bat     # Windows launcher (uses XAMPP's php.exe)
│   └── .htaccess             # Blocks web access to the checker
├── images/icons/             # SVG icons
└── pages/
    ├── index.php, login.php, register.php, logout.php
    ├── admin.php, configure-smart-situations.php
    ├── smart-situations.php, preferences.php, history.php
    ├── nav-bar.php           # Shared sidebar + account menu
    ├── api/                  # JSON endpoints (see below)
    ├── css/
    └── js/
```

## Database

Tables used by the app:

| Table             | Purpose                                                  |
|-------------------|----------------------------------------------------------|
| `occupant`        | User accounts (username, email, bcrypt password hash)    |
| `user_type`       | Roles (`user`, `admin`)                                  |
| `user_preference` | Per-user settings stored as JSON                         |
| `situation_rule`  | Smart situation rules (conditions, actions, enabled)     |
| `situation`       | Situation occurrences with status and evidence           |
| `event_history`   | Activity log (device commands, account and situation events) |
| `home`            | Home / site information                                  |

## API endpoints (`pages/api/`)

All endpoints return JSON and require a logged-in session (`401` otherwise). Admin-only endpoints return `403` for normal users.

| Endpoint                 | Method(s)            | Description                                          |
|--------------------------|----------------------|------------------------------------------------------|
| `rooms.php`              | GET                  | List rooms (Home Assistant areas), minus hidden ones; `?all=1` includes hidden |
| `room-sensors.php`       | GET `?room=`         | Current sensor values for a room                     |
| `room-devices.php`       | GET `?room=`         | Controllable devices in a room                       |
| `device-command.php`     | POST (JSON)          | Turn on/off or set a value on devices in a room      |
| `sensor-history.php`     | GET `?period=`       | Sensor history for charts                            |
| `preferences.php`        | POST                 | Save user preferences                                |
| `account.php`            | POST, PATCH, DELETE  | Update or delete your own account                    |
| `situations.php`         | GET, POST            | List situations (`?count` for the badge) and change their status |
| `situation-catalog.php`  | include              | Shared definitions of entities, operators and actions |
| `admin-users.php`        | GET, POST, PATCH, DELETE | Manage users *(admin)*                          |
| `admin-situations.php`   | GET, POST, PATCH, DELETE | Manage smart situation rules *(admin)*          |
| `admin-history.php`      | GET `?q=&type=&period=&offset=` | Paginated activity log *(admin)*         |
| `hass.php`, `hass-client.php` | include         | Home Assistant client and shared helpers             |

## Security notes

- Passwords are hashed with `password_hash()` and checked with `password_verify()`.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS; strict session mode is on.
- All SQL uses PDO prepared statements.
- Credentials live outside the repo (`config.php` is also in `.gitignore`).
- The `checker/` folder is blocked from the web via `.htaccess` and only runs from the CLI.
