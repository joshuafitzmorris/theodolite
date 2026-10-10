# guards: open with a write mode, Path writers, shutil and os writers resolve by destination path
import os
import shutil
from pathlib import Path


def files(p, name):
    open("uploads/a.txt", "w")  # expect: fs.uploads high
    open("uploads/b.bin", "wb")  # expect: fs.uploads high
    open("uploads/c.log", "a")  # expect: fs.uploads high
    open("uploads/d", mode="x")  # expect: fs.uploads high
    open("uploads/e", "r+")  # expect: fs.uploads high
    Path("uploads/f").write_text("")  # expect: fs.uploads high
    Path("uploads/g").write_bytes(b"")  # expect: fs.uploads high
    (Path("uploads") / "h.txt").touch()  # expect: fs.uploads high
    shutil.copy("tmp/a", "uploads/i")  # expect: fs.uploads high
    shutil.copytree("tmp/a", "uploads/j")  # expect: fs.uploads high
    shutil.move("tmp/a", "uploads/k")  # expect: fs.uploads high
    shutil.rmtree("uploads/l")  # expect: fs.uploads high
    os.remove("uploads/m")  # expect: fs.uploads high
    os.makedirs("uploads/n")  # expect: fs.uploads high
    os.rename("tmp/a", "uploads/o")  # expect: fs.uploads high
    open(p, "w")  # expect: ? medium
    open("out.log", "w")  # expect: unmapped high
