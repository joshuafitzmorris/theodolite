"""INSERT INTO users (a) VALUES (1) in a module docstring."""
# guards: SQL in line comments, docstrings and block strings used as docstrings is not a site
# cur.execute("INSERT INTO users (a) VALUES (1)")


class Repo:
    """DELETE FROM orders is described here."""

    def run(self, cur):
        """
        UPDATE users SET a = 1
        """
        return 1
