# guards: a variable, f-string field, concatenation or placeholder as the table reports "?" unless its text is an alias; execute(variable) is a site only when the variable holds a write statement, so a SELECT, a job executor and a connection helper are not
SELECT_ALL = "SELECT * FROM users"
STMT = "DELETE {}"


def dynamic(cur, t, query, users_table, other, executor, job, conn):
    cur.execute(f"DELETE FROM {t}")  # expect: ? high
    cur.execute("INSERT INTO " + t + " (a) VALUES (1)")  # expect: ? high
    cur.execute("INSERT INTO %s (a) VALUES (1)" % t)  # expect: ? high
    cur.execute(f"DELETE FROM {other}.users")  # expect: db.users high
    cur.execute("DELETE FROM {}".format(t))  # expect: ? high
    cur.execute(STMT)  # expect: ? high
    cur.execute(SELECT_ALL)
    cur.execute(query)
    conn.execute(query)
    executor.execute(job)
    cur.executemany(users_table, [])  # expect: db.users high
