const express = require ('express');
const AWS = require ('aws-sdk');
const multer = require ('multer');
const bodyParser = require ('body-parser');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;
const sharp = require('sharp'); 
require('dotenv').config();

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

const rekognition = new AWS.Rekognition();

//Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: function (req, file, cb){
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
})
const upload = multer({ storage: storage }).single('image');

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: false}));
app.use(bodyParser.json());

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.get('/', (req, res) => {
    res.render('index', { error: null, labels: [], processedImage: null });
});

async function drawBoundingBoxes(imagePath, labels) {
    try {
        const image = sharp(imagePath);
        const { width, height } = await image.metadata();
        
        // Create SVG overlay with bounding boxes
        let svgOverlay = `<svg width="${width}" height="${height}">`;
        
        labels.forEach((label, index) => {
            if (label.Instances && label.Instances.length > 0) {
                label.Instances.forEach(instance => {
                    if (instance.BoundingBox) {
                        const box = instance.BoundingBox;
                        const x = box.Left * width;
                        const y = box.Top * height;
                        const boxWidth = box.Width * width;
                        const boxHeight = box.Height * height;
                        
                        // Different colors for different labels
                        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
                        const color = colors[index % colors.length];
                        
                        svgOverlay += `
                            <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" 
                                  fill="none" stroke="${color}" stroke-width="3" opacity="0.8"/>
                            <text x="${x}" y="${y - 5}" font-family="Arial" font-size="16" 
                                  fill="${color}" font-weight="bold">${label.Name} (${Math.round(label.Confidence)}%)</text>
                        `;
                    }
                });
            }
        });
        
        svgOverlay += '</svg>';
        
        // Generate output filename
        const outputPath = imagePath.replace(path.extname(imagePath), '_processed' + path.extname(imagePath));
        
        // Composite the SVG overlay onto the image
        await image
            .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
            .png()
            .toFile(outputPath);
            
        return outputPath;
    } catch (error) {
        console.error('Error drawing bounding boxes:', error);
        return null;
    }
}

app.post('/upload', (req, res) => {
    upload(req, res, async function (err) {
        if(err instanceof multer.MulterError){
            return res.render('index', { error: error.message, labels: [] });
        } else if (err){
            return res.render('index', {error: 'Error uploading file', labels: []});
        }
        const image = req.file;

        if(image){
            const imagePath = image.path;
            const imageBuffer = fs.readFileSync(imagePath);
            const params = {
                Image: {
                    Bytes: imageBuffer
                },
                MaxLabels: 10,
                MinConfidence: 70
            };

            try {
                const data = await new Promise((resolve, reject) => {
                    rekognition.detectLabels(params, (err, data) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(data);
                        }
                    });
                });

                // Draw bounding boxes on the image
                const processedImagePath = await drawBoundingBoxes(imagePath, data.Labels);
                const processedImageUrl = processedImagePath ? '/' + processedImagePath : null;
                
                res.render('index', {
                    error: null, 
                    labels: data.Labels,
                    processedImage: processedImageUrl
                });
            } catch (err) {
                console.log(err, err.stack);
                res.render('index', { error: 'Error analyzing image', labels: [], processedImage: null });
            }
            

        } else {
            res.render('index', {error: 'Please upload an image file', labels: []})
        }
    });
});

app.listen(port, () => {
    console.log('App running at http://localhost:3000');
});

function testAWSConnection() {
    rekognition.describeCollection({CollectionId: 'test'}, (err, data) => {
        if (err) {
            if (err.code === 'ResourceNotFoundException') {
                console.log('✅ AWS connection working! (ResourceNotFoundException is expected)');
            } else if (err.code === 'AccessDeniedException') {
                console.log('❌ AWS access denied - check your credentials');
            } else {
                console.log('AWS connection error:', err.code);
            }
        } else {
            console.log('✅ AWS connection successful!');
        }
    });
}

// Call this when your app starts
testAWSConnection();