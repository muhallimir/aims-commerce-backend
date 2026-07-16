#!/bin/bash
# ============================================
# AIMS Commerce — Database Migration Script
# Prerequisites: Supabase project created, DATABASE_URL configured
# ============================================

# Set your Supabase PostgreSQL connection
DATABASE_URL="${DATABASE_URL:?ERROR: DATABASE_URL not set in environment}"

echo "=== AIMS Commerce Database Migration ==="
echo "Target: Supabase PostgreSQL"
echo ""

# Step 1: Extensions
echo "[1/4] Installing PostgreSQL extensions..."
psql "$DATABASE_URL" -f prisma/migrations/1_extensions.sql
if [ $? -ne 0 ]; then echo "FAILED: Extensions"; exit 1; fi

# Step 2: Create all tables, FKs, indexes, triggers
echo "[2/4] Creating tables, constraints, and indexes..."
psql "$DATABASE_URL" -f prisma/migrations/0_init_mongodb_migration/migration.sql
if [ $? -ne 0 ]; then echo "FAILED: Schema"; exit 1; fi

# Step 3: RLS Policies
echo "[3/4] Applying Row-Level Security policies..."
psql "$DATABASE_URL" -f prisma/migrations/2_rls_policies.sql
if [ $? -ne 0 ]; then echo "FAILED: RLS Policies"; exit 1; fi;

# Step 4: Mongoose hook equivalent triggers
echo "[4/4] Installing Mongoose hook triggers..."
psql "$DATABASE_URL" -f prisma/migrations/4_mongoose_hooks_to_triggers.sql
if [ $? -ne 0 ]; then echo "FAILED: Triggers"; exit 1; fi

echo ""
echo "✅ Database migration complete!"
echo ""
echo "Tables created: users, sellers, products, orders, order_items, reviews"
echo "Extensions: pgcrypto, pg_trgm"
echo "RLS: Enabled on user-facing tables"
