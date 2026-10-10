# guards: a model created through a session or manager is one site on that model
def build(session):
    session.add(Event(a=1))  # expect: db.events medium
    Event.objects.create(a=1)  # expect: db.events medium
