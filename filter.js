var filters = {
    grayscale : function( src ) {
        return src.map(
            function(data, idx) {
                var lev  = Math.round(data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
                data[idx] = data[idx+1] = data[idx+2] = lev;
            }
        );
    },
    invert : function( src ) {
        return src.map(function( data, idx ) {
            data[idx] = 255 - data[idx]; ++idx;
            data[idx] = 255 - data[idx]; ++idx;
            data[idx] = 255 - data[idx];
        });
    },
    brightness : function( src, val ) {
        var clp = clamp;
        return src.map(function( data, idx ) {
            data[idx] = clp(data[idx] + val, 0, 255); ++idx;
            data[idx] = clp(data[idx] + val, 0, 255); ++idx;
            data[idx] = clp(data[idx] + val, 0, 255);
        });
    },
    contrast : function( src, val ) {
        var factor = Math.max((128 + val) / 128, 0);
        var clp = clamp;
        return src.map(function( data, idx ) {
            data[idx] = clp( data[idx] * factor, 0, 255); ++idx;
            data[idx] = clp( data[idx] * factor, 0, 255); ++idx;
            data[idx] = clp( data[idx] * factor, 0, 255);
        });
    },
    brightnesscontrast : function( src, alpha, beta ) {
        var factor = Math.max((128 + alpha) / 128, 0);
        var clp = clamp;
        return src.map(function( data, idx ) {
            data[idx] = clp( data[idx] * factor + beta, 0, 255); ++idx;
            data[idx] = clp( data[idx] * factor + beta, 0, 255); ++idx;
            data[idx] = clp( data[idx] * factor + beta, 0, 255);
        });
    },
    histogram : function( src ) {
        // histogram equalization, blended with original image
        // amount is between 0 and 1
        var h = src.h, w = src.w;

        // grayscale image
        var gimg = filters.grayscale(src);

        // build histogram (pdf)
        var hist = histogram(gimg, 0, 0, w, h);

        // compute cdf
        var cdf = buildcdf( hist );
        var cumuhist = normalizecdf(cdf, 255);

        var round = Math.round;
        var clp = clamp;

        // equalize
        return src.map(function( data, idx ){
            var lev = gimg.data[idx];
            var cI = cumuhist[lev];
            var ratio = cI / lev;
            data[idx] = clp(round(data[idx] * ratio), 0, 255); ++idx;
            data[idx] = clp(round(data[idx] * ratio), 0, 255); ++idx;
            data[idx] = clp(round(data[idx] * ratio), 0, 255);
        });
    },
    ahe : function( src ) {
        // find a good window size
        var h = src.h, w = src.w;

        // tile size
        var tilesize = [64, 64];

        // number of bins
        var num_bins = 256;

        // number of tiles in x and y direction
        var xtiles = Math.ceil(w / tilesize[0]);
        var ytiles = Math.ceil(h / tilesize[1]);

        var cdfs = new Array(ytiles);
        for(var i=0;i<ytiles;i++)
            cdfs[i] = new Array(xtiles);

        var inv_tile_size = [1.0 / tilesize[0], 1.0 / tilesize[1]];

        var binWidth = 256 / num_bins;

        var gimg = filters.grayscale(src);

        // create histograms
        for(var i=0;i<ytiles;i++)
        {
            var y0 = i * tilesize[1];
            var y1 = Math.min(y0+tilesize[1], h);
            for(var j=0;j<xtiles;j++)
            {
                var x0 = j * tilesize[0];
                var x1 = Math.min(x0+tilesize[0], w);
                var hist = histogram(gimg, x0, y0, x1, y1, num_bins);

                var cdf = buildcdf( hist );
                cdf = normalizecdf(cdf, 255);

                cdfs[i][j] = cdf;
            }
        }

        var dst = new RGBAImage(w, h);
        var srcdata = src.data;

        for(var y=0, idx=0;y<h;++y)
        {
            for(var x=0;x<w;++x, idx+=4)
            {
                // intensity of current pixel
                var I = gimg.getPixel(x, y).r;

                // bin index
                var bin = Math.floor(I / binWidth);

                // current tile
                var tx = x * inv_tile_size[0] - 0.5;
                var ty = y * inv_tile_size[1] - 0.5;

                var xl = Math.max(Math.floor(tx), 0);
                var xr = Math.min(xl+1, xtiles-1);

                var yt = Math.max(Math.floor(ty), 0);
                var yd = Math.min(yt+1, ytiles-1);

                var fx = tx - xl;
                var fy = ty - yt;

                var cdf11 = cdfs[yt][xl][bin];
                var cdf12 = cdfs[yd][xl][bin];
                var cdf21 = cdfs[yt][xr][bin];
                var cdf22 = cdfs[yd][xr][bin];

                // bilinear interpolation
                var Iout = (1 - fx) * (1 - fy) * cdf11
                    + (1 - fx) * 	   fy  * cdf12
                    +      fx  * (1 - fy) * cdf21
                    +      fx  *      fy  * cdf22;

                var ratio = Iout / I;
                var c = new Color(srcdata[idx] * ratio, srcdata[idx+1] * ratio, srcdata[idx+2] * ratio, srcdata[idx+3]);
                dst.setPixel(x, y, c.clamp());
            }
        }

        return dst;
    },
    // lut is the look up table defined by the input curve
    curve : function(src, lut, channel) {
        switch( channel )
        {
            case 'red':
            {
                return src.map(function(data, idx) {
                    data[idx] = lut[data[idx]];
                });
            }
            case 'green':
            {
                return src.map(function(data, idx) {
                    data[idx+1] = lut[data[idx+1]];
                });
            }
            case 'blue':
            {
                return src.map(function(data, idx) {
                    data[idx+2] = lut[data[idx+2]];
                });
            }
            case 'brightness':
            default:
            {
                var round = Math.round;
                var clp = clamp;
                return src.map(function(data, idx) {
                    var lev = round(data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
                    var bias = 1e-6;			// prevent divide by zero
                    var ratio = lut[lev]/(lev + bias);
                    data[idx] = clp(round(data[idx] * ratio), 0, 255); ++idx;
                    data[idx] = clp(round(data[idx] * ratio), 0, 255); ++idx;
                    data[idx] = clp(round(data[idx] * ratio), 0, 255);
                });
            }
        }
    },
    reduction : function(src, method, colors) {
        switch(method) {
            case 'uniform': {
                var levs = Math.ceil(Math.pow(colors, 1.0/3.0));
                var round = Math.round;
                return src.map(function(data, idx) {
                    data[idx] = round(round((data[idx] / 255.0) * levs) / levs * 255.0); ++idx;
                    data[idx] = round(round((data[idx] / 255.0) * levs) / levs * 255.0); ++idx;
                    data[idx] = round(round((data[idx] / 255.0) * levs) / levs * 255.0);
                });
            }
            case 'population': {
                var hist = colorHistogram(src, 0, 0, src.w, src.h);
                var rcdf = normalizecdf( buildcdf(hist[0]) );
                var gcdf = normalizecdf( buildcdf(hist[1]) );
                var bcdf = normalizecdf( buildcdf(hist[2]) );

                var levels = Math.ceil(Math.pow(colors, 1.0/3.0));

                // get sample points using CDF
                var genSamples = function(cdf) {
                    var pts = [];
                    var step = (1.0 - cdf[0]) / levels;

                    for(var j=0;j<=levels;j++) {
                        var p = step * j + cdf[0];
                        for(var i=1;i<256;i++) {
                            if( cdf[i-1] <= p && cdf[i] >= p ) {
                                pts.push(i);
                                break;
                            }
                        }
                    }
                    return pts;
                };

                // sample points in each channel
                var rPoints = genSamples(rcdf),
                    gPoints = genSamples(gcdf),
                    bPoints = genSamples(bcdf);

                // assemble the samples to a color table
                return src.map(function(data, idx) {
                    // find closet r sample point
                    data[idx] = findClosest(data[idx], rPoints); ++idx;

                    // find closet g sample point
                    data[idx] = findClosest(data[idx], gPoints); ++idx;

                    // find closet b sample point
                    data[idx] = findClosest(data[idx], bPoints);
                });
            }
            case 'mediancut': {
                var colormap = algorithms.mediancut(src, colors);
                return src.map(function(data, idx) {
                    var nc = findClosestColor(new Color(data[idx], data[idx+1], data[idx+2], data[idx+3]), colormap);
                    data[idx] = nc.r; ++idx;
                    data[idx] = nc.g; ++idx;
                    data[idx] = nc.b;
                });
            }
            case 'knn': {
                var colormap = algorithms.kmeans(src, colors);
                return src.map(function(data, idx) {
                    var nc = findClosestColor(new Color(data[idx], data[idx+1], data[idx+2], data[idx+3]), colormap);
                    data[idx] = nc.r; ++idx;
                    data[idx] = nc.g; ++idx;
                    data[idx] = nc.b;
                });
            }
            case 'ann': {
                var colormap = algorithms.neuralnetwork(src, colors);
                return src.map(function(data, idx) {
                    var nc = findClosestColor(new Color(data[idx], data[idx+1], data[idx+2], data[idx+3]), colormap);
                    data[idx] = nc.r; ++idx;
                    data[idx] = nc.g; ++idx;
                    data[idx] = nc.b;
                });
            }
        }
    },
    spatialfilter : function( src, f ) {

        console.log( 'applying spatial filter ...' ) ;
        // source image size
        var w = src.w, h = src.h;
        // filter size
        var wf = Math.floor((f.width - 1) / 2);
        var hf = Math.floor((f.height - 1) / 2);
        // filter weights
        var weights = f.weights;
        var bias = f.bias;
        // inverse of the scaling factor( sum of weights )
        var invfactor = 1.0 / f.factor;


        // slow implementation
        /*
         var round = Math.round;
         return src.map( function(r, g, b, a, x, y, w, h) {
            r = 0, g = 0, b = 0;
            for(var i=-hf, fi= 0, fidx = 0;i<=hf;i++, fi++) {
                var py = clamp(i+y, 0, h-1);
                for(var j=-wf, fj=0;j<=wf;j++, fj++, fidx++) {
                    var px = clamp(j+x, 0, w-1);
                    var wij = weights[fidx];
                    var cij = src.getPixel(px, py);
                    r += cij.r * wij;
                    g += cij.g * wij;
                    b += cij.b * wij;
                }
            }
            r = round(clamp(r * invfactor + bias, 0, 255));
            g = round(clamp(g * invfactor + bias, 0, 255));
            b = round(clamp(b * invfactor + bias, 0, 255));

            return new Color(r, g, b, a);
        } );
        */

        // fast implementation
        var dst = new RGBAImage(w, h);
        var srcdata = src.data;
        var dstdata = dst.data;
        var round = Math.round;
        var clp = clamp;
        for(var y = 0,idx=0;y<h;++y) {
            for(var x=0;x<w;++x) {
                var r = 0, g = 0, b = 0;
                for(var i=-hf, fi= 0, fidx = 0;i<=hf;++i, ++fi) {
                    var py = clp(i+y, 0, h-1);
                    for(var j=-wf, fj=0;j<=wf;++j, ++fj, ++fidx) {
                        var px = clp(j+x, 0, w-1);
                        var pidx = (py * w + px) * 4;
                        var wij = weights[fidx];
                        r += srcdata[pidx] * wij;
                        g += srcdata[++pidx] * wij;
                        b += srcdata[++pidx] * wij;
                    }
                }
                r = round(clp(r * invfactor + bias, 0, 255));
                g = round(clp(g * invfactor + bias, 0, 255));
                b = round(clp(b * invfactor + bias, 0, 255));

                dstdata[idx] = r; ++idx;
                dstdata[idx] = g; ++idx;
                dstdata[idx] = b; ++idx;
                dstdata[idx] = 255; ++idx;
            }
        }
        return dst;
    }
};