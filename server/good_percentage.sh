#!/bin/bash

sqlite3 /root/AniSage/server/server.db "SELECT ROUND(100.0 * SUM(CASE WHEN raw_rating >= 8 THEN 1 ELSE 0 END) / COUNT(*), 2) FROM user_ratings WHERE user_id != 7 AND (was_recommended = 1 OR was_recommended = 'true');"
