export function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err.message);

  const status = err.statusCode || 400;
  res.status(status).json({
    error: err.message || 'Ha ocurrido un error interno en el servidor'
  });
}
