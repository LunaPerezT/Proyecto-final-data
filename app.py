"""
API Flask para Chatbot de Ventas
=================================

FORMATO DE SALIDA PERSONALIZADO PARA EL FRONTEND

ENTRADA (del frontend):
{
    "message": "¿cuántas ventas por tipo?"
}

SALIDA (al frontend):
{
    "exito": True,
    "session_id": "uuid",
    "mensaje": "texto explicativo",
    "sql_generado": "SELECT...",
    "datos": [{...}],
    "columnas": ["col1", "col2"],
    "total_filas": 10,
    "tipo_grafica": "bar|line|pie|None",
    "tiene_grafica": True/False,
    "grafica_base64": "data:image/png;base64,..." (NUEVO)
}
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import requests
import uuid

# ============================================
# CONFIGURACIÓN
# ============================================

MCP_SERVER_URL = "http://localhost:3000"
REQUEST_TIMEOUT = 60

# ============================================
# INICIALIZAR FLASK
# ============================================
app = Flask(__name__)

CORS(app, resources={
    r"/api/*": {
        "origins": "*",
        "methods": ["POST", "GET", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})


# ============================================
# FUNCIONES AUXILIARES
# ============================================

def generar_session_id():
    """Genera un UUID único para la sesión"""
    return str(uuid.uuid4())


def verificar_servidor_mcp():
    """Verifica que server.js esté corriendo"""
    try:
        response = requests.get(f"{MCP_SERVER_URL}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data.get('status') == 'ok'
        return False
    except Exception as e:
        print(f"[ERROR] Servidor MCP no disponible: {e}")
        return False


def llamar_mcp_query(pregunta, usuario_id="anonimo", rol="ventas"):
    """
    Llama al endpoint /api/query de server.js
    
    RETORNA respuesta de server.js:
    {
        "exito": bool,
        "tipo": "texto|tabla|numero|grafico",
        "mensaje": string,
        "datos": array,
        "columnas": array,
        "sql_generado": string,
        "grafico": {
            "tipo": "bar|column|line|pie",
            "base64": "data:image/png;base64,..."
        },
        "usuario_id": string,
        "rol": string
    }
    """
    payload = {
        "pregunta": pregunta,
        "usuario_id": usuario_id,
        "rol": rol
    }
    
    url = f"{MCP_SERVER_URL}/api/query"
    
    print(f"[Flask→MCP] Enviando: {pregunta}")
    
    try:
        response = requests.post(
            url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()
        resultado = response.json()
        
        print(f"[MCP→Flask] Respuesta recibida - Tipo: {resultado.get('tipo')}")
        return resultado
        
    except requests.exceptions.Timeout:
        print("[ERROR] Timeout esperando respuesta de server.js")
        return {
            "exito": False,
            "tipo": "texto",
            "mensaje": "La consulta tardó demasiado. Intenta simplificar tu pregunta.",
            "datos": [],
            "columnas": [],
            "sql_generado": None,
            "grafico": None
        }
        
    except requests.exceptions.ConnectionError:
        print("[ERROR] No se pudo conectar con server.js")
        return {
            "exito": False,
            "tipo": "texto",
            "mensaje": "El servidor de procesamiento no está disponible. Verifica que server.js esté corriendo.",
            "datos": [],
            "columnas": [],
            "sql_generado": None,
            "grafico": None
        }
        
    except Exception as e:
        print(f"[ERROR] Error llamando a server.js: {e}")
        return {
            "exito": False,
            "tipo": "texto",
            "mensaje": f"Error al procesar la consulta: {str(e)}",
            "datos": [],
            "columnas": [],
            "sql_generado": None,
            "grafico": None
        }


def determinar_tipo_grafica(tipo_mcp, datos, columnas, grafico_mcp):
    """
    Determina el tipo de gráfica basándose en la respuesta de server.js
    
    PARÁMETROS:
    - tipo_mcp: "texto", "tabla", "numero", "grafico" (de server.js)
    - datos: array de objetos
    - columnas: array de strings
    - grafico_mcp: objeto con {tipo, base64} o None
    
    RETORNA:
    - tipo_grafica: "bar" | "line" | "pie" | None
    - tiene_grafica: bool
    - grafica_base64: string con imagen base64 o None
    """
    # Si server.js generó un gráfico, usarlo directamente
    if grafico_mcp and isinstance(grafico_mcp, dict):
        if 'base64' in grafico_mcp and grafico_mcp['base64']:
            return grafico_mcp['tipo'], True, grafico_mcp['base64']
    
    # Si es tipo grafico pero no hay base64, determinar tipo
    if tipo_mcp == 'grafico':
        # Intentar determinar tipo apropiado
        num_filas = len(datos) if datos else 0
        num_cols = len(columnas) if columnas else 0
        
        if 2 <= num_filas <= 6 and num_cols == 2:
            return "pie", False, None
        elif num_filas > 10:
            return "line", False, None
        elif num_filas > 1:
            return "bar", False, None
    
    # Si es tabla, determinar si podría tener gráfica
    if tipo_mcp == 'tabla' and datos and len(datos) > 0 and len(columnas) >= 2:
        num_filas = len(datos)
        num_cols = len(columnas)
        
        if 2 <= num_filas <= 6 and num_cols == 2:
            return "pie", False, None
        elif num_filas > 10:
            return "line", False, None
        elif num_filas > 1:
            return "bar", False, None
    
    # Sin gráfica
    return None, False, None


def convertir_respuesta_mcp_a_formato_personalizado(respuesta_mcp, session_id):
    """
    Convierte la respuesta de server.js al formato personalizado del frontend
    
    ENTRADA (de server.js):
    {
        "exito": True,
        "tipo": "grafico",
        "mensaje": "Se encontraron 3 productos",
        "datos": [{"producto": "Laptop", "total": 5000}],
        "columnas": ["producto", "total"],
        "sql_generado": "SELECT...",
        "grafico": {
            "tipo": "bar",
            "base64": "data:image/png;base64,..."
        },
        "usuario_id": "user123",
        "rol": "ventas"
    }
    
    SALIDA (formato personalizado):
    {
        "exito": True,
        "session_id": "uuid",
        "mensaje": "texto explicativo",
        "sql_generado": "SELECT...",
        "datos": [{...}],
        "columnas": ["col1", "col2"],
        "total_filas": 10,
        "tipo_grafica": "bar|line|pie|None",
        "tiene_grafica": True/False,
        "grafica_base64": "data:image/png;base64,..." (NUEVO)
    }
    """
    # 1. Extraer datos básicos de la respuesta MCP
    exito = respuesta_mcp.get('exito', False)
    tipo_mcp = respuesta_mcp.get('tipo', 'texto')
    mensaje = respuesta_mcp.get('mensaje', '')
    datos = respuesta_mcp.get('datos', [])
    columnas = respuesta_mcp.get('columnas', [])
    sql_generado = respuesta_mcp.get('sql_generado')
    grafico_mcp = respuesta_mcp.get('grafico')
    
    # 2. Calcular total de filas
    total_filas = len(datos) if isinstance(datos, list) else 0
    
    # 3. Determinar tipo de gráfica y extraer base64
    tipo_grafica, tiene_grafica, grafica_base64 = determinar_tipo_grafica(
        tipo_mcp, datos, columnas, grafico_mcp
    )
    
    # 4. Construir respuesta en formato personalizado
    respuesta_personalizada = {
        "exito": exito,
        "session_id": session_id,
        "mensaje": mensaje,
        "sql_generado": sql_generado,
        "datos": datos,
        "columnas": columnas,
        "total_filas": total_filas,
        "tipo_grafica": tipo_grafica,
        "tiene_grafica": tiene_grafica,
        "grafica_base64": grafica_base64  # NUEVO CAMPO
    }
    
    # 5. Devolver respuesta formateada
    return respuesta_personalizada


# ============================================
# ENDPOINTS
# ============================================

@app.route('/api/chat', methods=['POST'])
def chat_endpoint():
    """
    Endpoint principal del chatbot
    
    INPUT (del frontend):
    {
        "message": "¿cuántas ventas por tipo?",
        "session_id": "opcional - si no se envía, se genera uno nuevo",
        "usuario_id": "opcional",
        "rol": "ventas"
    }
    
    OUTPUT (al frontend - formato personalizado):
    {
        "exito": True,
        "session_id": "uuid",
        "mensaje": "texto explicativo",
        "sql_generado": "SELECT...",
        "datos": [{...}],
        "columnas": ["col1", "col2"],
        "total_filas": 10,
        "tipo_grafica": "bar|line|pie|None",
        "tiene_grafica": True/False,
        "grafica_base64": "data:image/png;base64,..." (NUEVO)
    }
    """
    # 1. Verificar que sea JSON
    if not request.is_json:
        return jsonify({
            "exito": False,
            "session_id": None,
            "mensaje": "Content-Type debe ser application/json",
            "sql_generado": None,
            "datos": [],
            "columnas": [],
            "total_filas": 0,
            "tipo_grafica": None,
            "tiene_grafica": False,
            "grafica_base64": None
        }), 400
    
    # 2. Obtener datos del request
    datos = request.get_json()
    
    # 3. Extraer mensaje (obligatorio)
    mensaje = datos.get('message', '').strip()
    
    # 4. Extraer o generar session_id
    session_id = datos.get('session_id')
    if not session_id:
        session_id = generar_session_id()
    
    # 5. Extraer parámetros opcionales
    usuario_id = datos.get('usuario_id', 'anonimo')
    rol = datos.get('rol', 'ventas')
    
    # 6. Validar mensaje
    if not mensaje:
        return jsonify({
            "exito": False,
            "session_id": session_id,
            "mensaje": "El campo 'message' es obligatorio y no puede estar vacío",
            "sql_generado": None,
            "datos": [],
            "columnas": [],
            "total_filas": 0,
            "tipo_grafica": None,
            "tiene_grafica": False,
            "grafica_base64": None
        }), 400
    
    # 7. Log
    print(f"\n{'='*60}")
    print(f"[Flask API] Nueva petición del chatbot")
    print(f"  Mensaje: {mensaje}")
    print(f"  Session ID: {session_id}")
    print(f"  Usuario: {usuario_id}")
    print(f"  Rol: {rol}")
    print(f"{'='*60}")
    
    try:
        # 8. Llamar a server.js
        respuesta_mcp = llamar_mcp_query(
            pregunta=mensaje,
            usuario_id=usuario_id,
            rol=rol
        )
        
        # 9. Convertir al formato personalizado
        respuesta_personalizada = convertir_respuesta_mcp_a_formato_personalizado(
            respuesta_mcp,
            session_id
        )
        
        # 10. Log de éxito
        print(f"[Flask API] ✓ Respuesta enviada al frontend")
        print(f"  Éxito: {respuesta_personalizada['exito']}")
        print(f"  Total filas: {respuesta_personalizada['total_filas']}")
        print(f"  Tiene gráfica: {respuesta_personalizada['tiene_grafica']}")
        print(f"  Tipo gráfica: {respuesta_personalizada['tipo_grafica']}")
        if respuesta_personalizada['grafica_base64']:
            print(f"  Base64 length: {len(respuesta_personalizada['grafica_base64'])} chars")
        
        # 11. Devolver respuesta
        return jsonify(respuesta_personalizada), 200
        
    except Exception as e:
        # 12. Manejo de errores
        print(f"[Flask API] ✗ Error: {str(e)}")
        
        return jsonify({
            "exito": False,
            "session_id": session_id,
            "mensaje": "Lo siento, hubo un error inesperado al procesar tu consulta.",
            "sql_generado": None,
            "datos": [],
            "columnas": [],
            "total_filas": 0,
            "tipo_grafica": None,
            "tiene_grafica": False,
            "grafica_base64": None
        }), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """Verifica estado del servidor Flask y del server.js"""
    mcp_disponible = verificar_servidor_mcp()
    
    respuesta = {
        "status": "ok" if mcp_disponible else "degraded",
        "components": {
            "flask": "ok",
            "mcp_server": "ok" if mcp_disponible else "unavailable"
        },
        "mcp_url": MCP_SERVER_URL,
        "timestamp": datetime.now().isoformat()
    }
    
    codigo = 200 if mcp_disponible else 503
    return jsonify(respuesta), codigo


@app.route('/api/schema', methods=['GET'])
def obtener_schema():
    """Obtiene schema de la BD desde server.js"""
    try:
        response = requests.get(f"{MCP_SERVER_URL}/api/schema", timeout=10)
        response.raise_for_status()
        data = response.json()
        return jsonify(data), 200
    except Exception as e:
        return jsonify({
            "error": f"No se pudo obtener el schema: {str(e)}",
            "status": "error"
        }), 500


@app.route('/api/tables', methods=['GET'])
def listar_tablas():
    """Lista tablas desde server.js"""
    try:
        response = requests.get(f"{MCP_SERVER_URL}/api/tables", timeout=10)
        response.raise_for_status()
        data = response.json()
        return jsonify(data), 200
    except Exception as e:
        return jsonify({
            "error": f"No se pudo listar tablas: {str(e)}",
            "status": "error"
        }), 500


@app.route('/api/ejemplos', methods=['GET'])
def obtener_ejemplos():
    """Obtiene ejemplos desde server.js"""
    try:
        response = requests.get(f"{MCP_SERVER_URL}/api/ejemplos", timeout=10)
        response.raise_for_status()
        data = response.json()
        return jsonify(data), 200
    except Exception as e:
        return jsonify({
            "error": f"No se pudo obtener ejemplos: {str(e)}",
            "status": "error"
        }), 500


@app.route('/', methods=['GET'])
def root():
    """Información del servidor"""
    return jsonify({
        "nombre": "Flask API - Chatbot de Ventas",
        "version": "2.1.0",
        "formato_salida": "personalizado con base64",
        "mcp_server": MCP_SERVER_URL,
        "endpoints": {
            "chat": "POST /api/chat",
            "health": "GET /api/health",
            "schema": "GET /api/schema",
            "tables": "GET /api/tables",
            "ejemplos": "GET /api/ejemplos"
        },
        "ejemplo_salida": {
            "exito": True,
            "session_id": "uuid",
            "mensaje": "texto",
            "sql_generado": "SELECT...",
            "datos": [{}],
            "columnas": ["col1"],
            "total_filas": 1,
            "tipo_grafica": "bar",
            "tiene_grafica": True,
            "grafica_base64": "data:image/png;base64,..."
        }
    }), 200


# ============================================
# INICIAR SERVIDOR
# ============================================
if __name__ == '__main__':
    print("")
    print("=" * 70)
    print("   FLASK API - CHATBOT DE VENTAS (v2.1)")
    print("   Formato de salida personalizado con GRÁFICAS BASE64")
    print("=" * 70)
    print("")
    print(f"Flask API:        http://localhost:5000")
    print(f"MCP Server:       {MCP_SERVER_URL}")
    print("")
    print("Formato de salida:")
    print("  {")
    print('    "exito": True,')
    print('    "session_id": "uuid",')
    print('    "mensaje": "texto explicativo",')
    print('    "sql_generado": "SELECT...",')
    print('    "datos": [{...}],')
    print('    "columnas": ["col1", "col2"],')
    print('    "total_filas": 10,')
    print('    "tipo_grafica": "bar|line|pie|None",')
    print('    "tiene_grafica": True/False,')
    print('    "grafica_base64": "data:image/png;base64,..." (NUEVO)')
    print("  }")
    print("")
    print("Endpoints disponibles:")
    print("  POST /api/chat      - Procesa mensajes del chatbot")
    print("  GET  /api/health    - Verifica estado")
    print("  GET  /api/schema    - Schema de la BD")
    print("  GET  /api/tables    - Lista de tablas")
    print("  GET  /api/ejemplos  - Ejemplos de preguntas")
    print("")
    
    # Verificar servidor MCP
    print("Verificando conexión con server.js...")
    if verificar_servidor_mcp():
        print("✓ Server.js conectado correctamente")
    else:
        print("⚠️  ADVERTENCIA: server.js no está disponible")
        print("   Inicia server.js con: node server.js")
    
    print("")
    print("Presiona Ctrl+C para detener")
    print("=" * 70)
    print("")
    
    # Iniciar Flask
    app.run(
        debug=True,
        host='0.0.0.0',
        port=5000
    )