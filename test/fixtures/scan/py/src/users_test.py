# guards: files named *_test.py are never scanned
def t(cur):
    cur.execute("INSERT INTO users (a) VALUES (1)")
