const express = require('express');
const path = require('path');
const {Client} = require('pg');
require('dotenv').config();
const PORT = process.env.PORT || 5000;
const bodyParser = require('body-parser');
const canvas = require('node-canvas');
const imgur = require('imgur');

imgur.setClientId(process.env.IMGUR_CLIENT_ID);
imgur.setAPIUrl('https://api.imgur.com/3/');


const app = express();
app.use(bodyParser.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'static')))
app.set('views', path.join(__dirname, 'static'))
app.set('view engine', 'ejs')

app.get(/.css$/, (req, res) => {
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(__dirname + '/static' + req.url)
})
app.get(/.js$/, (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(__dirname + '/static' + req.url)
})
app.get(/.png$/, (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.sendFile(__dirname + '/static' + req.url);
})
app.get(/.svg$/, (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.sendFile(__dirname + '/static' + req.url);
})

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect();

app.get('/', (req, res) => {
  res.render('pages/index')
})
app.get('/forum', (req, res) => {
  getAllSectionsData(2, (error, data) => {
    if (error) res.sendStatus(500);
    if (data) res.render('pages/forum', {sections_data: data})
  })
})

app.post('/database-request', (req, res) => {
  if (req.headers.cookie === process.env.ADMIN_TOKEN) {
    client.query(req.body.query, (error, result) => {
      if (error) {
          res.send({__error__: error.message})
      }
      else if (result) {
          delete result._types;
          res.send(result);
      } 
    })
  }
  else{
    res.sendStatus(403)
  }
})
app.get('/database', (req, res) => {
  if (req.headers.cookie === process.env.ADMIN_TOKEN) {
    res.render('pages/database');
  }
  else{
    res.sendStatus(403)
  }
})

app.post('/createSection', (req, res) => {
  let request_body = req.body;
  let parent_id = (request_body.parent_id == 0 || request_body.parent_id === null) ? null : Number(request_body.parent_id);
  canvas.loadImage(request_body.image_file || request_body.image_link).then(img => {
    let cnv = canvas.createCanvas(256, 256);
    let ctx = cnv.getContext('2d');
    ctx.drawImage(img, 0, 0, 256, 256);
    let d = cnv.toDataURL();
    d = d.substring(d.indexOf(',') + 1);
    if (d.length > 1000000){
      res.status(400).send({error: 'Image too big'});
      return;
    }
    imgur.uploadBase64(d, null, Date.now().toString())
    .then(result => {
      const request_string = `
  INSERT INTO Sections (parent_id, title, description, image, childrens) VALUES (${parent_id}, $$${request_body.title}$$, ${request_body.description ? `$$${request_body.description}$$` : null}, $$${result.link}$$, '{}') RETURNING *`;
      if (parent_id){
        client.query('SELECT id::boolean FROM Sections WHERE id = ' + parent_id + ' LIMIT 1').then(result => {
          if (result.rows[0]?.id){
            client.query(request_string, (error, result) => {
              if (error) res.status(400).send({error: 'Incorrect section data'});
              if (result) {
                client.query(`UPDATE Sections SET childrens = array_append(childrens, ${result.rows[0].id}) WHERE id = ${parent_id}`)
                res.status(200).send(result.rows[0])
              }
            })
          }
          else{
            res.status(404).send({error: 'Parent not found'})
          }
        })
        
      }
      else if (parent_id === null){
        client.query(request_string, (error, result) => {
          if (error) res.status(400).send({error: 'Incorrect section data'});
          if (result) res.status(200).send(result.rows[0]);
        })
      }
      else{
        res.status(400);
        return;
      }
    })
  })
  .catch(e => {
    res.status(400).send({error: 'Invalid image'});
  })
})

app.get('/getAllSections', (req, res) => {
  console.time('get all')
  getAllSectionsData(2, (error, data) => {
    console.timeEnd('get all')
    res.send(data)
  })
})
app.get(/\/getSection/, (req, res) => {
  console.time('get one')
  let match = req.url.match(/getSection\/([0-9]+)(\/|$)/);
  if (!match) {
      res.sendStatus(400);
      return;
  };
  getSectionData(match[1], 2, (error, data) => {
    console.timeEnd('get one')
    res.send(data)
  })
})
app.get(/\/deleteSection/, (req, res) => {
  let match = req.url.match(/deleteSection\/([0-9]+)(\/|$)/);
  if (!match) {
      res.sendStatus(400);
      return;
  };
  let id = match[1]
  Promise.all([
    client.query('UPDATE Sections SET parent_id = null WHERE parent_id = ' + id),
    client.query(`UPDATE Sections SET childrens = array_remove(childrens, ${id})`),
    client.query('DELETE FROM Sections * WHERE id = ' + id),
  ])
  .then(results => {
    if (!results[2].rowCount) {
      res.sendStatus(404)
    }
    else{
      res.sendStatus(200)
    }
  })
})

app.listen(PORT, () => console.log(`Listening on ${ PORT }`));

// ------------------------------------------------------

function getAllSectionsData(iterations_count = 2, callback){
  client.query('SELECT * FROM Sections WHERE parent_id IS NULL ORDER BY id').then(result => {
    sectionChildrenIterator(result.rows, iterations_count, callback)
  })
}
function getAllSectionsDataWithoutChildrens(callback){
  client.query('SELECT * FROM Sections').then(result => {
    callback(null, result.rows)
  })
}

function getSectionData(id, iterations_count = 2, callback){
  client.query(`SELECT * FROM Sections WHERE id = ${id} LIMIT 1`).then(result => {
    sectionChildrenIterator(result.rows, iterations_count, callback)
  })
}

// ------------------------------------------------------

function sectionChildrenIterator(data, iteration_count = 1, callback){
  let cycle_data = data;
  if (!cycle_data.length) {
    callback(null, [])
    return;
  }
  let ids = [];
  const iterator = () => {
    if (iteration_count-- > 0 && cycle_data.length){
      ids = [];
      cycle_data.forEach(section => {
          ids = ids.concat(section.childrens);
      })
      if (!ids.length){
        callback(null, data)
        return;
      }
      getSectionsFromParentArrayToObject(ids, (error, sections) => {
        cycle_data.forEach(section => {
          if (!section) return;
          section.childrens = sections[section.id] || [];
        })
        cycle_data = Object.values(sections).flat();
        iterator()
      })
    }
    else{
      callback(null, data)
    }
  }
  iterator()
}
function getSectionsFromParentArrayToObject(array, callback){
  let result = {};
  client.query(`SELECT * FROM Sections WHERE array[id] && array[${array}]`).then(res => {
    res.rows.forEach(section => {
      (result[section.parent_id]?.push(section)) || (result[section.parent_id] = [section]);
    })
    callback(null, result);
  })
}



// const section_example = {
//     id: 1,
//     parent_id: null,
//     image: '/images/section-1.png',
//     title: 'Первый раздел',
//     created_by: user_id,
//     childrens: [
//       {
//         id: 2,
//         parent_id: 1,
//         image: '/images/section-1.png',
//         title: 'Раздел в разделе',
//         created_by: user_id,
//         childrens: []
//       },
//       {
//         id: 3,
//         parent_id: 1,
//         image: '/images/section-1.png',
//         title: 'Раздел в разделе',
//         created_by: user_id,
//         childrens: []
//       },
//     ]
// }