# guards: a hash and a URL inside strings do not hide a later write
def literals(cur):
    note = "a # b"; url = "http://x"; cur.execute("DELETE FROM orders")  # expect: db.orders high
    return note, url
