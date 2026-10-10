# guards: lowercase "delete from" and "insert into" outside a SQL position are prose, not SQL
def prose():
    a = "delete from the list"
    b = "insert into cart"
    print("update users set the flag")
    return a, b
