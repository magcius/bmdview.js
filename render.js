
function createScene(gl) {
    var projection = mat4.create();
    mat4.perspective(projection, 2*22.5, gl.viewportWidth / gl.viewportHeight, 0.1*128, 2500*128);
 
    var modelView = mat4.create();

    var drawTypes = { "strip": gl.TRIANGLE_STRIP,
                      "fan": gl.TRIANGLE_FAN };

    gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
    gl.clearColor(77/255, 50/255, 153/255, 1);
    gl.enable(gl.DEPTH_TEST);

    function renderModel(model) {
        var matrices = [];
        for (var i = 0; i < 10; i++)
            matrices.push(mat4.create());

        function command_updateMatrix(command) {
            matrices[command.idx] = command.matrix;
        }

        function command_draw(command) {
            var prog = command.program;
            gl.useProgram(prog);

            gl.bindBuffer(gl.ARRAY_BUFFER, command.buffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, command.elementBuffer);

            var attribNames = prog.attribNames;
            attribNames.forEach(function(name) {
                gl.vertexAttribPointer(
                    prog.locations[name],          // location
                    command.attribSizes[name],     // size
                    gl.FLOAT,                      // type
                    false,                         // normalize
                    command.itemSize          * 4, // stride
                    command.attribOffs[name]  * 4  // offset
                );
                gl.enableVertexAttribArray(prog.locations[name]);
            });

            var matrixTable = matrices.slice();
            function updateMatrixTable(packet) {
                var updated = false;
                packet.matrixTable.forEach(function(idx, i) {
                    if (idx == -1)
                        return; // keep old

                    if (matrixTable[i] != matrices[idx]) {
                        matrixTable[i] = matrices[idx];
                        updated = true;
                    }
                });
                return updated;
            }

            gl.uniformMatrix4fv(prog.locations.projection, false, projection);
            gl.uniformMatrix4fv(prog.locations.modelView, false, modelView);

            command.packets.forEach(function(packet) {
                if (updateMatrixTable(packet))
                    gl.uniformMatrix4fv(prog.locations.vertexMatrix, false, matrixTable[0]);

                packet.primitives.forEach(function(prim) {
                    gl.drawElements(
                        drawTypes[prim.drawType], // mode
                        prim.count,               // count
                        gl.UNSIGNED_SHORT,        // type
                        prim.start * 2            // offset
                    );
                });
            });

            attribNames.forEach(function(name) {
                gl.disableVertexAttribArray(prog.locations[name]);
            });
        }

        var dispatch = {
            "draw": command_draw,
            "updateMatrix": command_updateMatrix,
        };

        model.commands.forEach(function(command) {
            dispatch[command.type](command);
        });
    }

    var models = [];

    var scene = {};

    function render() {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        models.forEach(renderModel);
    }

    scene.attachModel = function(model) {
        models.push(model);
        render();
    };
    scene.setCamera = function(matrix) {
        mat4.copy(modelView, matrix);
        render();
    };

    return scene;
}

function generateShader(decls, main) {
    var indentedMain = main.map(function(x) {
        return "    " + x;
    });

    return (decls.join("\n") + "\n\n" +
        "void main() {\n" +
        indentedMain.join("\n") + "\n" +
        "}\n");
}

function generateBatchVertShader(batch, bmd, material) {
    var uniforms = [];
    var varyings = [];
    var attributes = [];
    var attribNames = [];
    var main = [];

    // We should always have position.
    uniforms.push("uniform mat4 u_modelView;");
    uniforms.push("uniform mat4 u_projection;");

    attributes.push("attribute vec3 a_position;");
    attribNames.push("position");
    main.push("gl_Position = u_projection * u_modelView * vec4(a_position, 1.0);");

    for (var i = 0; i < 2; i++) {
        var name = "color" + i;
        if (!batch.attribNames[name])
            continue;

        varyings.push("varying vec4 v_" + name + ";");
        attributes.push("attribute vec4 a_" + name + ";");
        attribNames.push(name);
        main.push("v_" + name + " = a_" + name + ";");
    }

    var decls = [];
    decls.push.apply(decls, uniforms);
    decls.push("");
    decls.push.apply(decls, varyings);
    decls.push("");
    decls.push.apply(decls, attributes);
    return { attribNames: attribNames,
             src: generateShader(decls, main) };
}

function generateBatchFragShader(batch, bmd, material) {
    var header = [];
    var varyings = [];
    var main = [];

    header.push("precision mediump float;");

    if (batch.attribNames["color0"]) {
        varyings.push("varying vec4 v_color0;");
        main.push("gl_FragColor = v_color0;");
    }

    var decls = [];
    decls.push.apply(decls, header);
    decls.push("");
    decls.push.apply(decls, varyings);
    return { src: generateShader(decls, main) };
}

function compileShader(gl, str, type) {
    var shader = gl.createShader(type);

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
}

function generateBatchProgram(gl, batch, bmd, material) {
    var vertSrc = generateBatchVertShader(batch, bmd, material);
    var fragSrc = generateBatchFragShader(batch, bmd, material);

    var vert = compileShader(gl, vertSrc.src, gl.VERTEX_SHADER);
    var frag = compileShader(gl, fragSrc.src, gl.FRAGMENT_SHADER);

    var prog = gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);

    prog.locations = {};
    prog.uniformNames = ["modelView", "projection", "vertexMatrix"];
    prog.attribNames = vertSrc.attribNames;

    prog.uniformNames.forEach(function(name) {
        prog.locations[name] = gl.getUniformLocation(prog, "u_" + name);
    });
    prog.attribNames.forEach(function(name) {
        prog.locations[name] = gl.getAttribLocation(prog, "a_" + name);
    });

    return prog;
}

function translateBatch(gl, batch, bmd, material) {
    var command = { type: "draw" };

    function range(end) {
        var r = new Uint16Array(end);
        for (var i = 0; i < end; i++)
            r[i] = i;
        return r;
    }

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.verts, gl.STATIC_DRAW);
    command.buffer = buffer;

    var elementBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, range(batch.vertCount), gl.STATIC_DRAW);
    command.elementBuffer = elementBuffer;

    command.program = generateBatchProgram(gl, batch, bmd, material);
    command.vertCount = batch.vertCount;
    command.itemSize = batch.itemSize;
    command.packets = batch.packets;
    command.attribNames = batch.attribNames;
    command.attribSizes = batch.attribSizes;
    command.attribOffs = batch.attribOffs;

    return command;
}

function modelFromBmd(gl, bmd) {
    var model = {};
    model.commands = [];

    var material;

    bmd.inf1.entries.forEach(function(entry) {
        switch (entry.type) {
            case 0x01: // open child, not needed
            case 0x02: // close child, not needed
                break;
            case 0x10: // joint
                var matrix = bmd.jnt1.frames[entry.index];
                model.commands.push({ type: "updateMatrix", idx: entry.index, matrix: matrix });
                break;
            case 0x11: // material, TODO
                // var index = bmd.mat3.indexToMatIndex[entry.index];
                // material = bmd.mat3.materials[index];
                break;
            case 0x12: // batch
                var batch = bmd.shp1.batches[entry.index];
                model.commands.push(translateBatch(gl, batch, bmd, material));
                break;
        }
    });

    return model;
}

window.addEventListener('load', function() {
    var canvas = document.querySelector("canvas");
    var gl = canvas.getContext("experimental-webgl");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;

    var scene = createScene(gl);
    var camera = mat4.create();
    mat4.translate(camera, camera, [0, 0, -1280]);
    scene.setCamera(camera);

    loadModel("faceship.bmd", function(bmd) {
        var model = modelFromBmd(gl, bmd);
        scene.attachModel(model);
    });

    var keysDown = {};
    var SHIFT = 16;

    function isKeyDown(key) {
        return !!keysDown[key.charCodeAt(0)];
    }

    window.addEventListener('keydown', function(e) {
        keysDown[e.keyCode] = true;
    });
    window.addEventListener('keyup', function(e) {
        delete keysDown[e.keyCode];
    });

    var fps = 60;
    var interval = 1000 / fps;

    function update() {
        var cameraVel = vec3.create();
        var amount = 5;
        if (keysDown[SHIFT])
            amount *= 10;

        if (isKeyDown('W'))
            cameraVel[2] = amount;
        if (isKeyDown('S'))
            cameraVel[2] = -amount;
        if (isKeyDown('A'))
            cameraVel[0] = amount;
        if (isKeyDown('D'))
            cameraVel[0] = -amount;

        mat4.translate(camera, camera, cameraVel);
        scene.setCamera(camera);
        setTimeout(update, interval);
    }

    update();

});
