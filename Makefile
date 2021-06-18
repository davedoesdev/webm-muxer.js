OUTPUTS = webm-muxer.js webm-muxer.wasm
WEBM_TOOLS = webm-tools/shared
SOURCES_CC = webm-muxer.cc $(WEBM_TOOLS)/webm_live_muxer.cc $(WEBM_TOOLS)/webm_chunk_writer.cc
LIBRARY_JS = library.js

$(OUTPUTS): $(SOURCES_CC) $(LIBRARY_JS) Makefile
	$(CXX) \
		-O3 \
		--closure 1 \
		--std=c++17 \
		-Iwebm-tools/shared \
		-Ilibwebm \
		-Lbuild \
		-Wall \
		-s ASSERTIONS=0 \
		-s EXIT_RUNTIME=1 \
		-s TOTAL_MEMORY=67108864 \
		-s ASYNCIFY \
		-s 'ASYNCIFY_IMPORTS=["emscripten_read_async"]' \
		--js-library $(LIBRARY_JS) \
		-o $@ \
		$(SOURCES_CC) \
		-lwebm

clean:
	rm -f $(OUTPUTS)
