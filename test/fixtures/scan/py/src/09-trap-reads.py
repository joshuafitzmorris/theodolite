# guards: reads are never sites, including SELECT with updated_at or FOR UPDATE and ORM read calls
import requests


def reads(cur, session, p):
    cur.execute("SELECT * FROM users WHERE updated_at > %s", (1,))
    cur.execute("SELECT * FROM orders WHERE id = 1 FOR UPDATE")
    cur.execute("WITH x AS (SELECT 1) SELECT * FROM x")
    User.objects.filter(a=1)
    session.query(User)
    requests.get("https://api.example.org/x")
    open(p, "rb")
    open(p)
