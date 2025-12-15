/**
 * Servidor MCP PostgreSQL + Qwen3 + Charts
 * =========================================
 * 
 * Conecta con la base de datos real en Render
 * Graficos soportados: bar, column, line, pie
 * MODIFICADO: Genera gráficas como imágenes base64
 */

const express = require('express');
const cors = require('cors');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createCanvas } = require('canvas');

// ============================================================
// CONFIGURACION
// ============================================================

const CONFIG = {
    PORT: 3000,
    // Base de datos real en Render
    DB_URL:'postgresql://database_final_project_user:4jwEikmkqCst9WFPeevZuEhdtjtfIoiu@dpg-d4ttnde3jp1c73f51e9g-a.oregon-postgres.render.com:5432/database_final_project?sslmode=require',                                                                                                                                                                                                                                                                                                        
    OLLAMA_URL: 'http://localhost:11434',
    MODELO: 'qwen3'
};

// Schema de la base de datos real (para el prompt)
const SCHEMA_DESCRIPCION = `
SCHEMA DE LA BASE DE DATOS:

Tabla: employees (empleados)
  - employee_id (PK)
  - first_name (nombre)
  - last_name (apellido)
  - email
  - position (puesto)
  - department (departamento)
  - salary (salario)

Tabla: customers (clientes)
  - customer_id (PK)
  - first_name_customer (nombre)
  - last_name_customer (apellido)
  - email
  - region

Tabla: products (productos)
  - product_id (PK)
  - product_name (nombre del producto)
  - category (categoria)
  - unit_price (precio unitario)

Tabla: sales (ventas)
  - sale_id (PK)
  - employee_id (FK -> employees)
  - customer_id (FK -> customers)
  - product_id (FK -> products)
  - sales_channel (canal: online, tienda, etc)
  - quantity (cantidad)
  - discount_percentage (porcentaje descuento)
  - payment_method (metodo pago)
  - subtotal
  - discount_amount (cantidad descontada)
  - total
  - sale_timestamp (fecha y hora de la venta)

Tabla: users (usuarios del sistema)
  - Para autenticacion, no usar en queries de negocio

RELACIONES:
- sales.employee_id -> employees.employee_id (que empleado hizo la venta)
- sales.customer_id -> customers.customer_id (a que cliente)
- sales.product_id -> products.product_id (que producto)
`;

// Glosario de terminos de negocio
const GLOSARIO = `
GLOSARIO:
- ventas totales = SUM(total)
- ventas por empleado = JOIN sales con employees, GROUP BY employee
- ventas por producto = JOIN sales con products, GROUP BY product
- ventas por cliente = JOIN sales con customers, GROUP BY customer
- ventas por region = JOIN sales con customers, GROUP BY region
- ventas por mes = EXTRACT(MONTH FROM sale_timestamp)
- ventas por canal = GROUP BY sales_channel
- top empleados = ORDER BY SUM(total) DESC
- top productos = ORDER BY SUM(quantity) DESC o SUM(total) DESC
- nombre completo empleado = CONCAT(first_name, ' ', last_name)
- nombre completo cliente = CONCAT(first_name_customer, ' ', last_name_customer)
`;

// Palabras clave para graficos
const PALABRAS_GRAFICO = [
    'grafico', 'grafica', 'chart', 'visualiza', 'dibuja', 
    'diagrama', 'plot', 'barras', 'lineas', 'pastel', 'pie', 'columnas', 'tarta'
];

// Mapeo de tipos de grafico
const TIPOS_GRAFICO = {
    'barras': 'bar', 'barra': 'bar', 'bar': 'bar', 'horizontal': 'bar',
    'columnas': 'column', 'columna': 'column', 'column': 'column', 'vertical': 'column',
    'lineas': 'line', 'linea': 'line', 'line': 'line', 'tendencia': 'line', 'evolucion': 'line',
    'pastel': 'pie', 'pie': 'pie', 'circular': 'pie', 'tarta': 'pie', 'torta': 'pie', 'porcentaje': 'pie'
};

const TIPOS_PERMITIDOS = ['bar', 'column', 'line', 'pie'];

// ============================================================
// GENERADOR DE GRAFICAS EN BASE64
// ============================================================

function generarGraficaBase64(tipo, datos) {
    const width = 800;
    const height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    
    // Márgenes
    const margin = { top: 60, right: 40, bottom: 100, left: 80 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    
    // Colores
    const colors = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
    ];
    
    try {
        if (tipo === 'bar') {
            generarBarrasHorizontales(ctx, datos, margin, chartWidth, chartHeight, colors);
        } else if (tipo === 'column') {
            generarBarrasVerticales(ctx, datos, margin, chartWidth, chartHeight, colors);
        } else if (tipo === 'line') {
            generarLineas(ctx, datos, margin, chartWidth, chartHeight);
        } else if (tipo === 'pie') {
            generarPie(ctx, datos, width, height, colors);
        }
        
        // Convertir a base64
        const buffer = canvas.toBuffer('image/png');
        const base64 = buffer.toString('base64');
        return `data:image/png;base64,${base64}`;
        
    } catch (error) {
        console.error('Error generando gráfica:', error);
        return null;
    }
}

function generarBarrasHorizontales(ctx, datos, margin, chartWidth, chartHeight, colors) {
    const maxValue = Math.max(...datos.map(d => d.value));
    const barHeight = chartHeight / datos.length * 0.7;
    const barSpacing = chartHeight / datos.length;
    
    // Título
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gráfico de Barras', margin.left + chartWidth / 2, 30);
    
    datos.forEach((item, i) => {
        const barWidth = (item.value / maxValue) * chartWidth;
        const y = margin.top + i * barSpacing;
        
        // Barra
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(margin.left, y, barWidth, barHeight);
        
        // Etiqueta
        ctx.fillStyle = '#000000';
        ctx.font = '14px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(item.category, margin.left - 10, y + barHeight / 2 + 5);
        
        // Valor
        ctx.textAlign = 'left';
        ctx.fillText(item.value.toLocaleString(), margin.left + barWidth + 5, y + barHeight / 2 + 5);
    });
}

function generarBarrasVerticales(ctx, datos, margin, chartWidth, chartHeight, colors) {
    const maxValue = Math.max(...datos.map(d => d.value));
    const barWidth = chartWidth / datos.length * 0.7;
    const barSpacing = chartWidth / datos.length;
    
    // Título
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gráfico de Columnas', margin.left + chartWidth / 2, 30);
    
    datos.forEach((item, i) => {
        const barHeightActual = (item.value / maxValue) * chartHeight;
        const x = margin.left + i * barSpacing;
        const y = margin.top + chartHeight - barHeightActual;
        
        // Barra
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(x, y, barWidth, barHeightActual);
        
        // Valor encima
        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(item.value.toLocaleString(), x + barWidth / 2, y - 5);
        
        // Etiqueta abajo (rotada si es necesaria)
        ctx.save();
        ctx.translate(x + barWidth / 2, margin.top + chartHeight + 20);
        ctx.rotate(-Math.PI / 4);
        ctx.textAlign = 'right';
        ctx.fillText(item.category, 0, 0);
        ctx.restore();
    });
}

function generarLineas(ctx, datos, margin, chartWidth, chartHeight) {
    const maxValue = Math.max(...datos.map(d => d.value));
    const minValue = Math.min(...datos.map(d => d.value));
    const valueRange = maxValue - minValue || 1;
    
    // Título
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gráfico de Líneas', margin.left + chartWidth / 2, 30);
    
    // Ejes
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + chartHeight);
    ctx.lineTo(margin.left + chartWidth, margin.top + chartHeight);
    ctx.stroke();
    
    // Línea de datos
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    
    datos.forEach((item, i) => {
        const x = margin.left + (i / (datos.length - 1)) * chartWidth;
        const y = margin.top + chartHeight - ((item.value - minValue) / valueRange) * chartHeight;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        // Punto
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Etiqueta
        ctx.fillStyle = '#000000';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(item.time, x, margin.top + chartHeight + 20);
    });
    
    ctx.stroke();
}

function generarPie(ctx, datos, width, height, colors) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;
    
    // Título
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Gráfico Circular', centerX, 30);
    
    const total = datos.reduce((sum, item) => sum + item.value, 0);
    let currentAngle = -Math.PI / 2;
    
    datos.forEach((item, i) => {
        const sliceAngle = (item.value / total) * Math.PI * 2;
        
        // Sector
        ctx.fillStyle = colors[i % colors.length];
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fill();
        
        // Borde
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Etiqueta
        const labelAngle = currentAngle + sliceAngle / 2;
        const labelX = centerX + Math.cos(labelAngle) * (radius * 0.7);
        const labelY = centerY + Math.sin(labelAngle) * (radius * 0.7);
        
        const percentage = ((item.value / total) * 100).toFixed(1);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${percentage}%`, labelX, labelY);
        
        currentAngle += sliceAngle;
    });
    
    // Leyenda
    const legendX = width - 150;
    let legendY = 100;
    
    datos.forEach((item, i) => {
        // Cuadro de color
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(legendX, legendY, 20, 20);
        
        // Texto
        ctx.fillStyle = '#000000';
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(item.category, legendX + 30, legendY + 15);
        
        legendY += 30;
    });
}

// ============================================================
// CLIENTE MCP POSTGRESQL
// ============================================================

class MCPPostgresClient {
    constructor() {
        this.client = null;
        this.transport = null;
    }
    
    async connect() {
        this.transport = new StdioClientTransport({
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres', CONFIG.DB_URL]
        });
        
        this.client = new Client({
            name: 'chatbot-sql-client',
            version: '1.0.0'
        }, {
            capabilities: {}
        });
        
        await this.client.connect(this.transport);
        console.log('>> MCP PostgreSQL conectado (Render)');
        return this;
    }
    
    async disconnect() {
        if (this.client) {
            await this.client.close();
        }
    }
    
    async query(sql) {
        try {
            const result = await this.client.callTool({
                name: 'query',
                arguments: { sql }
            });
            
            if (result.content && result.content[0]) {
                const text = result.content[0].text;
                try {
                    return { exito: true, datos: JSON.parse(text), error: null };
                } catch {
                    return { exito: true, datos: text, error: null };
                }
            }
            return { exito: true, datos: [], error: null };
        } catch (error) {
            return { exito: false, datos: [], error: error.message };
        }
    }
    
    async getSchema() {
        return SCHEMA_DESCRIPCION;
    }
    
    async listTables() {
        return ['employees', 'customers', 'products', 'sales', 'users'];
    }
}

// ============================================================
// OLLAMA (QWEN3)
// ============================================================

async function llamarOllama(prompt, temperature = 0.1) {
    try {
        const response = await fetch(`${CONFIG.OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: CONFIG.MODELO,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                options: { temperature }
            })
        });
        
        const data = await response.json();
        return data.message?.content || '';
    } catch (error) {
        console.error('Error llamando Ollama:', error.message);
        return `ERROR: ${error.message}`;
    }
}

function generarSQL(pregunta) {
    const prompt = `/no_think
Genera SOLO la query SQL para PostgreSQL. Sin explicaciones, sin markdown, sin comentarios.

${SCHEMA_DESCRIPCION}

${GLOSARIO}

REGLAS IMPORTANTES:
1. Solo SELECT (nunca INSERT, UPDATE, DELETE)
2. Siempre incluye LIMIT 100
3. Para nombres completos usa: CONCAT(first_name, ' ', last_name) AS nombre
4. Para fechas usa: EXTRACT(MONTH FROM sale_timestamp) o DATE_TRUNC('month', sale_timestamp)
5. Siempre usa alias descriptivos (AS total_ventas, AS nombre_empleado, etc)
6. Para JOINs usa los IDs correctos:
   - sales.employee_id = employees.employee_id
   - sales.customer_id = customers.customer_id  
   - sales.product_id = products.product_id

EJEMPLOS:
- "ventas por empleado" -> SELECT CONCAT(e.first_name, ' ', e.last_name) AS empleado, SUM(s.total) AS total_ventas FROM sales s JOIN employees e ON s.employee_id = e.employee_id GROUP BY e.employee_id, e.first_name, e.last_name ORDER BY total_ventas DESC LIMIT 100;
- "top 5 productos" -> SELECT p.product_name AS producto, SUM(s.quantity) AS cantidad_vendida FROM sales s JOIN products p ON s.product_id = p.product_id GROUP BY p.product_id, p.product_name ORDER BY cantidad_vendida DESC LIMIT 5;
- "ventas por mes" -> SELECT EXTRACT(MONTH FROM sale_timestamp) AS mes, SUM(total) AS total_ventas FROM sales GROUP BY mes ORDER BY mes LIMIT 100;

PREGUNTA: ${pregunta}

SQL:`;

    return llamarOllama(prompt, 0.1);
}

function formatearRespuesta(pregunta, datos) {
    if (!datos || datos.length === 0) {
        return 'No se encontraron datos para tu consulta.';
    }
    
    if (datos.length === 1 && Object.keys(datos[0]).length === 1) {
        const valor = Object.values(datos[0])[0];
        return `El resultado es: ${valor}`;
    }
    
    const prompt = `/no_think
Responde brevemente (1-2 frases) a la pregunta basandote en los datos.
No menciones SQL ni bases de datos. Se conciso.

Pregunta: ${pregunta}
Datos: ${JSON.stringify(datos.slice(0, 5))}
Total registros: ${datos.length}

Respuesta:`;

    return llamarOllama(prompt, 0.3);
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function detectarPeticionGrafico(pregunta) {
    const preguntaLower = pregunta.toLowerCase();
    for (const palabra of PALABRAS_GRAFICO) {
        if (preguntaLower.includes(palabra)) {
            return true;
        }
    }
    return false;
}

function detectarTipoGrafico(pregunta) {
    const preguntaLower = pregunta.toLowerCase();
    for (const [palabra, tipo] of Object.entries(TIPOS_GRAFICO)) {
        if (preguntaLower.includes(palabra)) {
            return tipo;
        }
    }
    return 'bar';
}

function prepararDatosParaGrafico(datos, tipoGrafico) {
    if (!Array.isArray(datos) || datos.length === 0) {
        return [];
    }
    
    const keys = Object.keys(datos[0]);
    
    // Para graficos de linea, necesita {time, value}
    if (tipoGrafico === 'line') {
        return datos.map(row => {
            const values = Object.values(row);
            return {
                time: String(values[0]),
                value: parseFloat(values[1]) || 0
            };
        });
    }
    
    // Para bar, column, pie: {category, value}
    return datos.map(row => {
        const values = Object.values(row);
        return {
            category: String(values[0]),
            value: parseFloat(values[1]) || 0
        };
    });
}

function validarSQL(sql) {
    const sqlUpper = sql.toUpperCase().trim();
    
    if (!sqlUpper.startsWith('SELECT')) {
        return { valido: false, mensaje: 'Solo se permiten consultas SELECT' };
    }
    
    const prohibidas = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    for (const op of prohibidas) {
        if (new RegExp(`\\b${op}\\b`).test(sqlUpper)) {
            return { valido: false, mensaje: `Operacion no permitida: ${op}` };
        }
    }
    
    if (/;\s*\w+/.test(sqlUpper)) {
        return { valido: false, mensaje: 'Multiples statements no permitidos' };
    }
    
    if (sql.includes('--') || sql.includes('/*')) {
        return { valido: false, mensaje: 'Comentarios no permitidos' };
    }
    
    return { valido: true, mensaje: 'OK' };
}

function limpiarSQL(sql) {
    sql = sql.replace(/```sql\s*/gi, '');
    sql = sql.replace(/```\s*/g, '');
    sql = sql.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    const match = sql.match(/SELECT\s+[\s\S]+/i);
    if (match) {
        sql = match[0];
    }
    
    sql = sql.split(/\s+/).join(' ').trim();
    
    if (!sql.endsWith(';')) {
        sql += ';';
    }
    
    return sql;
}

// ============================================================
// API REST
// ============================================================

async function crearAPI() {
    const app = express();
    
    app.use(cors());
    app.use(express.json());
    
    // Conectar MCP PostgreSQL
    console.log('>> Conectando con MCP PostgreSQL (Render)...');
    const mcp = new MCPPostgresClient();
    await mcp.connect();
    
    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', database: 'Render PostgreSQL' });
    });
    
    // Info
    app.get('/', (req, res) => {
        res.json({
            servicio: 'Chatbot SQL + Charts',
            database: 'Render PostgreSQL (database_final_project)',
            modelo: CONFIG.MODELO,
            graficos: TIPOS_PERMITIDOS,
            formato_grafico: 'base64',
            tablas: ['employees', 'customers', 'products', 'sales'],
            endpoints: [
                'POST /api/query',
                'POST /api/chart',
                'GET /api/chart/types',
                'GET /api/schema',
                'GET /api/tables',
                'GET /api/ejemplos'
            ]
        });
    });
    
    // Schema
    app.get('/api/schema', (req, res) => {
        res.json({ schema: SCHEMA_DESCRIPCION });
    });
    
    // Tablas
    app.get('/api/tables', (req, res) => {
        res.json({ tablas: ['employees', 'customers', 'products', 'sales'] });
    });
    
    // Ejemplos adaptados a la BD real
    app.get('/api/ejemplos', (req, res) => {
        res.json({
            ejemplos: [
                'Cuantas ventas hay en total?',
                'Top 5 empleados con mas ventas',
                'Ventas por producto',
                'Ventas por canal de venta',
                'Grafico de barras de ventas por empleado',
                'Grafico de lineas de ventas por mes',
                'Pie chart de ventas por metodo de pago',
                'Top 10 productos mas vendidos',
                'Ventas por region del cliente'
            ]
        });
    });
    
    // Tipos de grafico
    app.get('/api/chart/types', (req, res) => {
        res.json({ 
            tipos: TIPOS_PERMITIDOS,
            descripcion: {
                bar: 'Barras horizontales',
                column: 'Barras verticales',
                line: 'Lineas (tendencias)',
                pie: 'Circular (proporciones)'
            }
        });
    });
    
    // ENDPOINT PRINCIPAL
    app.post('/api/query', async (req, res) => {
        const { pregunta, usuario_id = 'anonimo', rol = 'ventas' } = req.body;
        
        const resultado = {
            exito: false,
            tipo: 'texto',
            mensaje: '',
            datos: [],
            columnas: [],
            sql_generado: null,
            grafico: null,
            usuario_id,
            rol
        };
        
        try {
            console.log(`\n>> Pregunta: ${pregunta}`);
            
            const quiereGrafico = detectarPeticionGrafico(pregunta);
            const tipoGrafico = quiereGrafico ? detectarTipoGrafico(pregunta) : null;
            
            if (quiereGrafico) {
                console.log(`>> Grafico solicitado: ${tipoGrafico}`);
            }
            
            // Generar SQL
            console.log('>> Generando SQL...');
            let sql = await generarSQL(pregunta);
            sql = limpiarSQL(sql);
            resultado.sql_generado = sql;
            console.log(`>> SQL: ${sql}`);
            
            // Validar
            const validacion = validarSQL(sql);
            if (!validacion.valido) {
                resultado.mensaje = `SQL rechazado: ${validacion.mensaje}`;
                return res.json(resultado);
            }
            
            // Ejecutar
            console.log('>> Ejecutando query...');
            const respuesta = await mcp.query(sql);
            
            if (!respuesta.exito) {
                resultado.mensaje = `Error: ${respuesta.error}`;
                return res.json(resultado);
            }
            
            const datos = respuesta.datos;
            resultado.datos = datos;
            
            if (Array.isArray(datos) && datos.length > 0) {
                resultado.columnas = Object.keys(datos[0]);
            }
            
            // Generar grafico si se pidio
            if (quiereGrafico && Array.isArray(datos) && datos.length > 0) {
                console.log('>> Generando grafico en base64...');
                
                try {
                    const datosGrafico = prepararDatosParaGrafico(datos, tipoGrafico);
                    const base64Image = generarGraficaBase64(tipoGrafico, datosGrafico);
                    
                    if (base64Image) {
                        resultado.grafico = {
                            tipo: tipoGrafico,
                            base64: base64Image
                        };
                        resultado.tipo = 'grafico';
                        console.log(`>> Grafico generado (${base64Image.length} caracteres)`);
                    } else {
                        resultado.grafico = { tipo: tipoGrafico, error: 'Error generando imagen' };
                    }
                } catch (chartError) {
                    resultado.grafico = { error: chartError.message };
                }
            }
            
            // Formatear respuesta
            console.log('>> Formateando respuesta...');
            const mensaje = await formatearRespuesta(pregunta, datos);
            
            if (resultado.tipo !== 'grafico') {
                if (datos.length === 1 && resultado.columnas.length === 1) {
                    resultado.tipo = 'numero';
                } else if (datos.length > 1) {
                    resultado.tipo = 'tabla';
                }
            }
            
            resultado.exito = true;
            resultado.mensaje = mensaje;
            
            console.log('>> OK');
            res.json(resultado);
            
        } catch (error) {
            console.error('>> Error:', error.message);
            resultado.mensaje = `Error: ${error.message}`;
            res.json(resultado);
        }
    });
    
    // Generar grafico directo
    app.post('/api/chart', async (req, res) => {
        const { tipo = 'bar', datos } = req.body;
        
        if (!TIPOS_PERMITIDOS.includes(tipo)) {
            return res.json({
                exito: false,
                error: `Tipo no soportado. Usa: ${TIPOS_PERMITIDOS.join(', ')}`
            });
        }
        
        try {
            const datosPreparados = prepararDatosParaGrafico(datos, tipo);
            const base64Image = generarGraficaBase64(tipo, datosPreparados);
            
            if (base64Image) {
                res.json({
                    exito: true,
                    tipo,
                    base64: base64Image
                });
            } else {
                res.json({
                    exito: false,
                    error: 'Error generando gráfica'
                });
            }
        } catch (error) {
            res.json({ exito: false, error: error.message });
        }
    });
    
    // Iniciar servidor
    app.listen(CONFIG.PORT, () => {
        console.log('');
        console.log('============================================================');
        console.log('   CHATBOT SQL + CHARTS - BASE DE DATOS RENDER');
        console.log('   Gráficas en formato BASE64');
        console.log('============================================================');
        console.log(`>> API: http://localhost:${CONFIG.PORT}`);
        console.log(`>> BD: database_final_project (Render)`);
        console.log(`>> Tablas: employees, customers, products, sales`);
        console.log(`>> Graficos: ${TIPOS_PERMITIDOS.join(', ')}`);
        console.log(`>> Formato: PNG Base64`);
        console.log('');
        console.log('Ctrl+C para detener.');
        console.log('============================================================');
    });
}

// ============================================================
// MAIN
// ============================================================

crearAPI().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});