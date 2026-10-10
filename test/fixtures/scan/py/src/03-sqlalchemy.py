# guards: SQLAlchemy sessions and core constructs resolve by model, session.query(Model).update/delete and bulk_save_objects are writes, and lowercase names need an alias
import sqlalchemy as sa
from sqlalchemy import insert, update, delete


def alchemy(session, db_session, users_table, audit_logs, thing):
    session.add(User(name="a"))  # expect: db.users medium
    db_session.add_all([Order(a=1)])  # expect: db.orders medium
    session.merge(Group(a=1))  # expect: db.groups medium
    session.delete(users_table)  # expect: db.users low
    insert(User).values(a=1)  # expect: db.users medium
    update(Order).values(a=1)  # expect: db.orders medium
    delete(Group)  # expect: db.groups medium
    sa.insert(Session)  # expect: db.sessions medium
    users_table.insert()  # expect: db.users low
    audit_logs.insert()
    session.add(thing)
    session.query(User).filter(User.id == 1).update({"a": 1})  # expect: db.users medium
    session.query(Order).delete()  # expect: db.orders medium
    session.bulk_save_objects([Group(a=1)])  # expect: db.groups medium
    session.query(User).filter(User.id == 1).first()
