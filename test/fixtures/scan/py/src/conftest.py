# guards: conftest.py is never scanned
def t(cur):
    cur.execute("INSERT INTO users (a) VALUES (1)")
