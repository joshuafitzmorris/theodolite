# guards: Django managers and instances resolve by model; a plain instance needs an alias
def django(user_store, thing):
    User.objects.create(name="a")  # expect: db.users medium
    Order.objects.get_or_create(a=1)  # expect: db.orders medium
    Group.objects.update_or_create(a=1)  # expect: db.groups medium
    User.objects.bulk_create([])  # expect: db.users medium
    Order.objects.bulk_update([], ["a"])  # expect: db.orders medium
    Group.objects.filter(a=1).update(b=2)  # expect: db.groups medium
    Order.objects.filter(a=1).delete()  # expect: db.orders medium
    user_store.save()  # expect: db.users low
    thing.save()
    thing.delete()
    return User.objects.filter(a=1).first()
