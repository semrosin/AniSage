#!/bin/bash
sqlite3 -noheader -batch server.db "SELECT AVG(raw_rating) FROM user_ratings WHERE user_id != 7 AND (was_recommended = 1 OR was_recommended = 'true');"

sqlite3 -noheader -batch server.db "SELECT COUNT(raw_rating) FROM user_ratings WHERE user_id != 7 AND (was_recommended = 1 OR was_recommended = 'true');"
