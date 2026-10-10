# guards: each SQL write shape is found in plain, f-string, prefixed and triple-quoted strings
def shapes(cur, n):
    cur.execute("INSERT INTO users (name) VALUES (%s)", (n,))  # expect: db.users high
    cur.execute("UPDATE users SET name = %s WHERE id = %s", (n, 1))  # expect: db.users high
    cur.execute("DELETE FROM orders WHERE id = %s", (1,))  # expect: db.orders high
    cur.execute("TRUNCATE TABLE audit_logs")  # expect: db.audit_logs high
    cur.execute("MERGE INTO groups g USING s ON g.id = s.id WHEN MATCHED THEN DELETE")  # expect: db.groups high
    cur.execute("ALTER TABLE users ADD COLUMN age int")  # expect: db.users high
    cur.execute("DROP TABLE IF EXISTS orders")  # expect: db.orders high
    cur.execute("CREATE TABLE IF NOT EXISTS audit_logs (id int)")  # expect: db.audit_logs high
    cur.executemany("INSERT INTO purchase_orders (a) VALUES (%s)", [(1,)])  # expect: db.orders high
    cur.execute(f"UPDATE users SET name = '{n}'")  # expect: db.users high
    cur.execute("""INSERT INTO "public"."Groups" (a) VALUES (1)""")  # expect: db.groups high
    cur.execute(rb"delete from legacy_accounts")  # expect: db.legacy_accounts high
    cur.execute("INSERT INTO webhooks_inbox (a) VALUES (1)")  # expect: unmapped high
