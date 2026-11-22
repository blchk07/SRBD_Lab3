from datetime import date, datetime
from decimal import Decimal
import re
import pyodbc


CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=AutoPartsDB_Lab2;"
    "Trusted_Connection=yes;"
    "TrustServerCertificate=yes;"
)


class SqlServerException(Exception):
    def __init__(self, sqlstate: str, error_code: int | None, message: str, procedure: str = ""):
        self.sqlstate = sqlstate
        self.error_code = error_code
        self.message = message
        self.procedure = procedure
        super().__init__(message)


def get_connection() -> pyodbc.Connection:
    return pyodbc.connect(CONN_STR, autocommit=False)


def _normalize_value(val):
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, datetime):
        return val.isoformat(sep=" ")
    if isinstance(val, date):
        return val.isoformat()
    return val


def _rows_to_dicts(cursor: pyodbc.Cursor) -> list[dict]:
    columns = [col[0] for col in cursor.description]
    rows = []
    for row in cursor.fetchall():
        rows.append({col: _normalize_value(row[i]) for i, col in enumerate(columns)})
    return rows


def parse_odbc_error(exc: pyodbc.Error, procedure: str = "") -> SqlServerException:
    sqlstate = str(exc.args[0]) if exc.args else "HY000"
    raw_msg = str(exc.args[1]) if len(exc.args) > 1 else str(exc)

    # дістаємо текст повідомлення і код помилки з відповіді SQL Server
    match = re.search(r"\[SQL Server\](.*?)\s*\((\d+)\)\s*\([^)]+\)\s*$", raw_msg, re.DOTALL)
    if match:
        return SqlServerException(
            sqlstate=sqlstate,
            error_code=int(match.group(2)),
            message=match.group(1).strip(),
            procedure=procedure,
        )

    clean_msg = raw_msg.split("[SQL Server]")[-1].strip() if "[SQL Server]" in raw_msg else raw_msg.strip()
    return SqlServerException(sqlstate=sqlstate, error_code=None, message=clean_msg, procedure=procedure)


def fetch_all(query: str, params: tuple = ()) -> list[dict]:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query, params)
        if cursor.description is None:
            return []
        return _rows_to_dicts(cursor)
    except pyodbc.Error as exc:
        raise parse_odbc_error(exc) from exc
    finally:
        conn.close()


def fetch_one(query: str, params: tuple = ()) -> dict | None:
    rows = fetch_all(query, params)
    return rows[0] if rows else None


def execute_procedure(sql: str, params: tuple = (), proc_name: str = "") -> None:
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        # проходимо всі пакети результатів перед commit
        while cursor.nextset():
            pass
        conn.commit()
    except pyodbc.Error as exc:
        conn.rollback()
        raise parse_odbc_error(exc, procedure=proc_name) from exc
    finally:
        conn.close()
