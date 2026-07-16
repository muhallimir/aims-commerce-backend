# Migration Execution Guide — Phase 3

## Prerequisites
- Supabase project must be created at https://supabase.com/dashboard
- `DATABASE_URL` and `DIRECT_URL` must be set in `.env` with real values

## How to Apply the Migration

### Option A: Using Supabase CLI (Recommended)

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project (if not already linked)
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B: Using psql Directly

```bash
# Run the migration script
cd prisma/migrations
chmod +x run_migration.sh
DATABASE_URL="postgresql://postgres.<ref>.supabase.com:6543/postgres" bash run_migration.sh
```

### Option C: Using Supabase SQL Editor

1. Go to Dashboard → SQL Editor → New query
2. Copy-paste the contents of these files **in order**:
   - 1_extensions.sql
   - 0_init_mongodb_migration/migration.sql (the full DDL)
   - 2_rls_policies.sql
   - 4_mongoose_hooks_to_triggers.sql (or 3_triggers_sync_seller.sql)

## Expected Tables After Migration

| Table | Row Count (seed) | Primary Key |
|-------|-----------------|-------------|
| `users` | 2 | UUID |
| `sellers` | 1 | UUID |
| `products` | 16 | UUID |
| `orders` | 0 | UUID |
| `order_items` | 0 | UUID |
| `reviews` | 0 | UUID |

## Verification Queries

```sql
-- Check all tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public'
ORDER BY tablename;

-- Check extensions
SELECT extname FROM pg_extension;

-- Check triggers
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public';

-- Check indexes
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
```

## Next Steps
1. ✅ Complete Phase 3
2. Proceed to **Phase 4: Seed Data Migration**
