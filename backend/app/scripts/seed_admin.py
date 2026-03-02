from app.scripts.seed import _ensure_admin_user


def main() -> None:
    _ensure_admin_user()


if __name__ == "__main__":
    main()
