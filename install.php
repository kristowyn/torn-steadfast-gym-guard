<?php
// install.php — serve the userscript with the correct headers for Tampermonkey
header('Content-Type: application/javascript; charset=utf-8');
header('Content-Disposition: inline; filename="steadfast-gym-guard.user.js"');
readfile(__DIR__ . '/steadfast-gym-guard.user.js');
