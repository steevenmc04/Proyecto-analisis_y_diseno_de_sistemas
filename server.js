const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3000;
const SECRET = "gym-secret-key";

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'admin',
  database: 'gymdb'
});

db.connect(err => {
  if(err) return console.error('Error MySQL:', err);
  console.log('Conectado a MySQL ✅');
});

// Middleware auth
function auth(req,res,next){
  const header = req.headers['authorization'];
  if(!header) return res.status(401).json({message:"No autorizado"});
  const token = header.split(' ')[1];
  if(!token) return res.status(401).json({message:"No autorizado"});
  try{
    const decoded = jwt.verify(token,SECRET);
    req.clienteId = decoded.id;
    next();
  }catch(err){
    return res.status(401).json({message:"Token inválido"});
  }
}

// Registro de clientes
app.post('/register', async (req,res)=>{
  const {nombre,cedula,email,password} = req.body;
  if(!nombre || !cedula || !email || !password) return res.status(400).json({message:"Faltan campos"});
  const hashed = await bcrypt.hash(password,8);
  const sql = 'INSERT INTO clientes (nombre, cedula, email, password) VALUES (?,?,?,?)';
  db.query(sql,[nombre,cedula,email,hashed],(err,result)=>{
    if(err){
      if(err.code==='ER_DUP_ENTRY') return res.status(400).json({message:"Cédula o correo ya registrado"});
      return res.status(500).json({message:"Error al registrar"});
    }
    res.json({message:"Usuario registrado correctamente"});
  });
});

// Login
app.post('/login', (req,res)=>{
  const {user,password} = req.body;
  if(!user || !password) return res.status(400).json({message:"Faltan campos"});
  const sql = 'SELECT * FROM clientes WHERE email=? OR cedula=?';
  db.query(sql,[user,user], async (err,results)=>{
    if(err) return res.status(500).json({message:"Error servidor"});
    if(results.length===0) return res.status(400).json({message:"Usuario no encontrado"});
    const cliente = results[0];
    const valid = await bcrypt.compare(password,cliente.password);
    if(!valid) return res.status(400).json({message:"Contraseña incorrecta"});
    const token = jwt.sign({id:cliente.id},SECRET,{expiresIn:"2h"});
    res.json({token});
  });
});

// Verificar token
app.get('/verify-token', auth, (req,res)=>{
  res.json({valid: true, clienteId: req.clienteId});
});

// Obtener membresías
app.get('/membresias', (req,res)=>{
  db.query('SELECT * FROM membresias',(err,results)=>{
    if(err) return res.status(500).json({message:"Error al obtener membresías"});
    res.json(results);
  });
});

// Obtener clases
app.get('/clases', (req,res)=>{
  db.query('SELECT * FROM clases',(err,results)=>{
    if(err) return res.status(500).json({message:"Error al obtener clases"});
    res.json(results);
  });
});

// Obtener pagos del cliente y actualizar estado automáticamente
app.get('/mis-pagos', auth, (req,res)=>{
  const sql = `
    SELECT p.id, p.monto, p.fecha_pago, p.estado, m.nombre, m.duracion_dias, p.membresia_id
    FROM pagos p
    JOIN membresias m ON p.membresia_id = m.id
    WHERE p.cliente_id = ?
  `;
  db.query(sql,[req.clienteId],(err,results)=>{
    if(err) return res.status(500).json({message:"Error al obtener pagos"});
    const hoy = new Date();
    const pagosActualizados = results.map(p=>{
      const fechaPago = new Date(p.fecha_pago);
      const diasTranscurridos = Math.floor((hoy - fechaPago)/(1000*60*60*24));
      if(diasTranscurridos >= p.duracion_dias) p.estado = 'No activo';
      return p;
    });
    res.json(pagosActualizados);
  });
});

// Comprar membresía (se registra como Activo)
// Comprar membresía
app.post('/mis-pagos', auth, (req,res)=>{
  const { membresia_id, monto } = req.body;
  if(!membresia_id || !monto) return res.status(400).json({message:"Faltan datos"});

  // Obtener duración de la membresía
  db.query('SELECT duracion_dias FROM membresias WHERE id = ?', [membresia_id], (err, results)=>{
    if(err) return res.status(500).json({message:"Error al obtener membresía"});
    if(results.length === 0) return res.status(404).json({message:"Membresía no encontrada"});

    const duracionDias = results[0].duracion_dias;
    const fechaPago = new Date();
    const fechaVencimiento = new Date(fechaPago.getTime() + duracionDias*24*60*60*1000);

    const sql = 'INSERT INTO pagos (cliente_id, membresia_id, monto, estado, fecha_pago, fecha_vencimiento) VALUES (?,?,?,?,?,?)';
    db.query(sql, [req.clienteId, membresia_id, monto, 'Activo', fechaPago, fechaVencimiento], (err,result)=>{
      if(err) return res.status(500).json({message:"Error al registrar pago: " + err.message});
      res.json({message:"Membresía comprada correctamente"});
    });
  });
});


// Servir index
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// Iniciar servidor
app.listen(PORT,()=>console.log(`Servidor corriendo en http://localhost:${PORT}`));
