# guards: files named test_*.py are never scanned
def t(cur):
    cur.execute("INSERT INTO users (a) VALUES (1)")
