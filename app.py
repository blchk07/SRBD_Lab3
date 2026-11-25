from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import (
    SqlServerException,
    execute_dml,
    execute_procedure,
    fetch_all,
    fetch_one,
    insert_good_with_guard,
)


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="AutoPartsDB API")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.exception_handler(SqlServerException)
async def sql_error_handler(_request: Request, exc: SqlServerException):
    return JSONResponse(
        status_code=400,
        content={
            "source": "SQL Server",
            "sqlstate": exc.sqlstate,
            "error_code": exc.error_code,
            "procedure": exc.procedure,
            "message": exc.message,
        },
    )


class DepartmentCreate(BaseModel):
    name: str = ""
    info: str | None = None


class GoodPriceUpdate(BaseModel):
    good_id: int
    new_price: float


class GoodDiscountCreate(BaseModel):
    good_id: int
    discount: int


class SaleCreate(BaseModel):
    good_id: int
    quantity: int = 1
    check_no: int | None = None


class SaleQuantityUpdate(BaseModel):
    quantity: int


class GoodCreate(BaseModel):
    name: str
    price: float
    quantity: int = 1
    producer: str
    dept_id: int
    description: str | None = None


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/goods")
def get_goods():
    return fetch_all(
        """
        SELECT
            g.GoodId,
            g.Name,
            g.Price,
            g.Quantity,
            g.Producer,
            g.DeptId,
            d.Name AS DepartmentName,
            g.Description,
            COUNT(s.SaleId) AS SalesCount,
            ISNULL(SUM(s.Quantity), 0) AS TotalUnitsSold
        FROM Goods g
        JOIN Departments d ON g.DeptId = d.DeptId
        LEFT JOIN Sales s ON g.GoodId = s.GoodId
        GROUP BY g.GoodId, g.Name, g.Price, g.Quantity, g.Producer, g.DeptId, d.Name, g.Description
        ORDER BY g.GoodId
        """
    )


@app.get("/api/goods/{good_id}")
def get_good_details(good_id: int):
    good = fetch_one(
        """
        SELECT
            g.GoodId,
            g.Name,
            g.Price,
            g.Quantity,
            g.Producer,
            g.DeptId,
            d.Name AS DepartmentName,
            d.Info AS DepartmentInfo,
            g.Description
        FROM Goods g
        JOIN Departments d ON g.DeptId = d.DeptId
        WHERE g.GoodId = ?
        """,
        (good_id,),
    )
    if not good:
        raise HTTPException(status_code=404, detail=f"Товар з ID={good_id} не знайдено")

    sales = fetch_all(
        """
        SELECT
            s.SaleId,
            s.CheckNo,
            s.SaleDate,
            s.Quantity,
            ISNULL(c.FullName, N'Роздрібний покупець') AS CustomerName,
            ISNULL(c.City, N'-') AS CustomerCity,
            CAST(s.Quantity * g.Price AS DECIMAL(12, 2)) AS TotalSum
        FROM Sales s
        JOIN Goods g ON s.GoodId = g.GoodId
        LEFT JOIN Customers c ON s.CustomerId = c.CustomerId
        WHERE s.GoodId = ?
        ORDER BY s.SaleDate DESC, s.SaleId DESC
        """,
        (good_id,),
    )
    return {"good": good, "sales": sales}


@app.get("/api/departments")
def get_departments():
    return fetch_all("SELECT DeptId, Name, Info FROM Departments ORDER BY DeptId")


@app.get("/api/workers")
def get_workers():
    return fetch_all(
        """
        SELECT w.WorkerId, w.Name, w.Position, w.DeptId, d.Name AS DepartmentName
        FROM Workers w
        JOIN Departments d ON w.DeptId = d.DeptId
        ORDER BY w.WorkerId
        """
    )


@app.get("/api/logs")
def get_trigger_logs():
    sales_logs = fetch_all(
        "SELECT Id, SaleId, OldQuantity, NewQuantity, ModifyDate FROM SalesLogs ORDER BY Id DESC"
    )
    access_logs = fetch_all(
        "SELECT LogId, GoodName, AttemptDate, UserName, StatusMessage FROM GoodsAccessLogs ORDER BY LogId DESC"
    )
    return {"sales_logs": sales_logs, "access_logs": access_logs}


@app.get("/api/sales")
def get_sales():
    return fetch_all(
        """
        SELECT TOP 30 s.SaleId, s.CheckNo, s.GoodId, g.Name AS GoodName, s.SaleDate, s.Quantity
        FROM Sales s
        JOIN Goods g ON s.GoodId = g.GoodId
        ORDER BY s.SaleId DESC
        """
    )


@app.put("/api/sales/{sale_id}")
def update_sale_quantity(sale_id: int, payload: SaleQuantityUpdate):
    affected = execute_dml(
        "UPDATE Sales SET Quantity = ? WHERE SaleId = ?",
        (payload.quantity, sale_id),
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail=f"Продаж із SaleId={sale_id} не знайдено")
    return {
        "status": "ok",
        "message": f"Кількість у продажі #{sale_id} змінено на {payload.quantity} шт. (спрацював тригер tr_SalesLogging)",
    }


@app.post("/api/goods")
def create_good(payload: GoodCreate):
    name = payload.name.strip()
    producer = payload.producer.strip()
    if not name or not producer:
        raise HTTPException(status_code=400, detail="Назва товару та виробник не можуть бути порожніми")

    desc = payload.description.strip() if payload.description and payload.description.strip() else None
    result = insert_good_with_guard(
        (name, payload.price, payload.quantity, producer, payload.dept_id, desc)
    )
    if result["blocked"]:
        return {
            "status": "blocked",
            "blocked_by_trigger": True,
            "message": f"Тригер tr_GoodsWeekendGuard: {result['log_message']}",
        }
    return {
        "status": "ok",
        "blocked_by_trigger": False,
        "message": f"Товар «{name}» успішно додано в каталог Goods",
    }


@app.post("/api/procedures/department", status_code=201)
def insert_department(payload: DepartmentCreate):
    info_val = payload.info.strip() if payload.info and payload.info.strip() else None
    execute_procedure(
        "EXEC usp_InsertDepartment @Name = ?, @Info = ?",
        (payload.name, info_val),
        proc_name="usp_InsertDepartment",
    )
    return {"status": "ok", "message": f"Підрозділ «{payload.name}» додано"}


@app.put("/api/procedures/good-price")
def update_good_price(payload: GoodPriceUpdate):
    execute_procedure(
        "EXEC usp_UpdateGoodPrice @GoodId = ?, @NewPrice = ?",
        (payload.good_id, payload.new_price),
        proc_name="usp_UpdateGoodPrice",
    )
    return {"status": "ok", "message": f"Ціну товару #{payload.good_id} змінено на {payload.new_price:.2f} грн"}


@app.post("/api/procedures/good-discount")
def set_good_discount(payload: GoodDiscountCreate):
    execute_procedure(
        "EXEC usp_SetGoodDiscount @GoodId = ?, @Discount = ?",
        (payload.good_id, payload.discount),
        proc_name="usp_SetGoodDiscount",
    )
    return {"status": "ok", "message": f"Знижку {payload.discount}% додано для товару #{payload.good_id}"}


@app.post("/api/procedures/process-sale", status_code=201)
def process_sale(payload: SaleCreate):
    execute_procedure(
        "EXEC usp_ProcessSale @GoodId = ?, @Quantity = ?, @CheckNo = ?",
        (payload.good_id, payload.quantity, payload.check_no),
        proc_name="usp_ProcessSale",
    )
    return {"status": "ok", "message": f"Продаж товару #{payload.good_id} ({payload.quantity} шт.) проведено"}


@app.get("/api/functions/scalar")
def run_scalar_functions(max_price: float = Query(3000.0)):
    row = fetch_one(
        """
        SELECT
            ROUND(AVG(Price), 2) AS avg_price,
            dbo.fn_CountGoodsBelowAveragePrice() AS below_avg_count,
            dbo.fn_GetGoodsCountByPriceLimit(?) AS within_limit_count
        FROM Goods
        """,
        (max_price,),
    )
    return {
        "max_price": max_price,
        "avg_price": row["avg_price"] if row else 0,
        "below_avg_count": row["below_avg_count"] if row else 0,
        "within_limit_count": row["within_limit_count"] if row else 0,
    }


@app.get("/api/functions/department-report/{dept_id}")
def get_department_report(dept_id: int):
    rows = fetch_all(
        """
        SELECT DepartmentName, GoodId, GoodName, Price, UnitsSold, TotalRevenue
        FROM dbo.fn_GetDepartmentSalesReport(?)
        ORDER BY TotalRevenue DESC, GoodId
        """,
        (dept_id,),
    )
    return {"dept_id": dept_id, "rows": rows}


@app.get("/api/functions/top-good-by-worker")
def get_top_good_by_worker(worker_name: str = Query(...)):
    rows = fetch_all(
        "SELECT GoodName, UnitsSold, StatusMessage FROM dbo.fn_GetTopSoldGoodByWorker(?)",
        (worker_name,),
    )
    for row in rows:
        row["WorkerName"] = worker_name
    return {"worker_name": worker_name, "rows": rows}
