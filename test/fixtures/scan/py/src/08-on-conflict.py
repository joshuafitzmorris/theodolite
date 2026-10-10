# guards: an upsert with ON CONFLICT DO UPDATE SET is one site, not two
def upsert(cur):
    cur.execute("INSERT INTO users (id, name) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET name = excluded.name")  # expect: db.users high
