//## Require Modules
//Basic modules required for the server side code.
var express = require('express');
var bodyParser = require('body-parser');
var unirest = require('unirest');
var natural = require('natural');

var db = require('./db/config');

var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

//##CLASSIFICATION FUNCTION
//The blackbox function takes three parameters
//* The `description` is passed into the the `natural.BayesClassifier` function to return Trash, Compost, or Recycling. The `description` is also stored into the database.
//* The `imgUrl` URL is stored into the database.
//* The `callback` will need to take a function to handle processing the return back to the client
var blackBox = function(description, imgUrl, callback){
  var classification;

  natural.BayesClassifier.load('./app/classifier.json', null, function(err, classifier) {
    classification = classifier.classify(description.name);

    db.db.sync().then(function() {
      return db.Item.create({
        category: classification,
        description: description.name,
        url: imgUrl
      })
      .then(function(newItem){
        callback(newItem.get('category'));
      });
    });
  });
}

//##TEST FUNCTION
//Used to confirm the communication between the server and client.
app.get('/api/test', function(req, res){
  res.send(200, 'SUCCESS!');
});

//##TOKEN REQUEST FUNCTION
//CamFind's API can take up to 20 seconds to return a description after submitting a token, because of this delay we keep pulling for a completed status so that a description can be returned.
//* `token` is a unique identifier for the image that you've submitted, it needs to be added to the get request's endpoint, so that a description can be returned.
//* `imgurl` The image url is passed because it needs to exist for the `blackBox`.
//* `callback` Will need to take a function to handle passing the `result.body` and `imgurl` into the `blackBox`.
var getReq = function(token, imgurl, callback){
  unirest.get("https://camfind.p.mashape.com/image_responses/" + token)
    .header("X-Mashape-Key", process.env.CAMFIND_KEY)
    .header("Accept", "application/json")
    .end(function (result) {
      if(result.body.status === 'completed'){
        callback(result.body, imgurl)
      } else {
        getReq(token, imgurl, callback);
      }
  });
};


//##PROCESS CLIENT SIDE IMAGE URL
//1. An image url is received from the client
//2. A POST request sends the image url and the location of the image to CamFind's API. A token is returned.
//3. A GET request is made with the token and a classification and description of the item is returned.
app.post('/api/imgurl', function(req, res){
  unirest.post("https://camfind.p.mashape.com/image_requests")
    .header("X-Mashape-Key", process.env.CAMFIND_KEY)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .header("Accept", "application/json")
    .send({
      "image_request[locale]": req.body.locale,
      "image_request[remote_image_url]": req.body.imgurl
    })
    .end(function (result) {
      getReq(result.body.token, req.body.imgurl, function(resultBody, imgURL){
        blackBox(resultBody, imgURL, function(classification){
          res.send(200, {classification: classification, description: resultBody});
        });
      });
    });
});

app.listen(process.env.PORT);