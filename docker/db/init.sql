-- Exécuté une seule fois, à la création du volume : crée la base de test et active les extensions
-- dans les deux bases (les migrations les recréent aussi avec IF NOT EXISTS, pour Azure et la CI).
CREATE DATABASE creno_test;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

\connect creno_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
