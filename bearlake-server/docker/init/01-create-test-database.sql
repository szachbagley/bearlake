-- Runs once, on first initialization of the data volume.
-- The suite drops and re-migrates this database on every run (plan D29).
CREATE DATABASE IF NOT EXISTS bearlake_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
